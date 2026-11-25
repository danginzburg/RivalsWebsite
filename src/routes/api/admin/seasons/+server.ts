import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { getSeasonLogoUrl } from '$lib/server/seasons/logo'
import { sanitizeSeasonProfile, type SeasonKind } from '$lib/seasons/profile'
import { sanitizeSeasonSchedule } from '$lib/seasons/schedule'
import { syncSeasonAccoladesSafely } from '$lib/server/accolades/season-sync'
import { invalidateFinalPlacements } from '$lib/server/seasons/finalPlacementsCache'
import { fetchCompetitiveMapRotation, RiotLookupError } from '$lib/server/riot/henrik'
import {
  mergeRotationIntoPool,
  normalizeMapPoolMode,
  resolveMapPool,
  resolveMapPoolMode,
  sanitizeMapPool,
} from '$lib/seasons/mapPool'

const SEASON_COLUMNS = `
  id,
  code,
  name,
  kind,
  starts_on,
  ends_on,
  is_active,
  signups_open,
  metadata,
  logo_path,
  summary,
  winner_team_id,
  runner_up_team_id,
  third_place_team_id,
  mvp_profile_id,
  champion_clip_url,
  final_leaderboard_batch_id,
  created_at
`

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Only the two known event kinds are accepted; anything else is a rivals event. */
function normalizeKind(value: unknown): SeasonKind {
  return value === 'external' ? 'external' : 'rivals'
}

async function listSeasons() {
  const { data, error: seasonsError } = await supabaseAdmin
    .from('seasons')
    .select(SEASON_COLUMNS)
    .order('is_active', { ascending: false })
    .order('starts_on', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (seasonsError) throw error(500, 'Failed to load seasons')
  // Storage URLs can only be built server-side, so resolve them here.
  return (data ?? []).map((season) => ({ ...season, logo_url: getSeasonLogoUrl(season) }))
}

export const GET: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals.user)
  const seasons = await listSeasons()
  return json({ seasons })
}

export const POST: RequestHandler = async ({ locals, request }) => {
  await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const code = normalizeOptional(body.code)
  const name = normalizeOptional(body.name)
  const startsOn = normalizeOptional(body.startsOn)
  const endsOn = normalizeOptional(body.endsOn)
  const isActive = Boolean(body.isActive)

  if (!code) throw error(400, 'Season code is required')
  if (!name) throw error(400, 'Season name is required')

  if (isActive) {
    await supabaseAdmin
      .from('seasons')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000')
  }

  const { data, error: insertError } = await supabaseAdmin
    .from('seasons')
    .insert({
      code,
      name,
      kind: normalizeKind(body.kind),
      starts_on: startsOn,
      ends_on: endsOn,
      is_active: isActive,
      metadata: {},
    })
    .select(SEASON_COLUMNS)
    .single()

  if (insertError) {
    if (insertError.code === '23505') throw error(409, 'Season code already exists')
    throw error(500, 'Failed to create season')
  }

  return json({
    success: true,
    season: data,
  })
}

export const PATCH: RequestHandler = async ({ locals, request }) => {
  await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const id = normalizeOptional(body.id)
  const code = normalizeOptional(body.code)
  const name = normalizeOptional(body.name)
  const startsOn = normalizeOptional(body.startsOn)
  const endsOn = normalizeOptional(body.endsOn)
  const isActive = Boolean(body.isActive)

  if (!id) throw error(400, 'Season id is required')
  if (!code) throw error(400, 'Season code is required')
  if (!name) throw error(400, 'Season name is required')

  if (isActive) {
    await supabaseAdmin.from('seasons').update({ is_active: false }).neq('id', id)
  }

  const updates: Record<string, unknown> = {
    code,
    name,
    starts_on: startsOn,
    ends_on: endsOn,
    is_active: isActive,
  }

  // Kind is only rewritten when the caller sends it, so a partial save can't
  // silently flip an event's type.
  if (body.kind !== undefined) updates.kind = normalizeKind(body.kind)

  // Signups are independent of the active flag, so the next season can take
  // registrations while the current event runs. Only one season takes them.
  if (body.signupsOpen !== undefined) {
    const signupsOpen = Boolean(body.signupsOpen)
    if (signupsOpen) {
      await supabaseAdmin.from('seasons').update({ signups_open: false }).neq('id', id)
    }
    updates.signups_open = signupsOpen
  }

  // Season results are only written when the caller actually sent them.
  // A payload that omits a field leaves it alone rather than clearing it, so
  // a partial save (renaming a season, toggling active) cannot wipe results.
  const RESULT_FIELDS = [
    ['summary', 'summary'],
    ['winnerTeamId', 'winner_team_id'],
    ['runnerUpTeamId', 'runner_up_team_id'],
    ['thirdPlaceTeamId', 'third_place_team_id'],
    ['mvpProfileId', 'mvp_profile_id'],
    ['finalLeaderboardBatchId', 'final_leaderboard_batch_id'],
  ] as const

  for (const [bodyKey, column] of RESULT_FIELDS) {
    if (body[bodyKey] !== undefined) updates[column] = normalizeOptional(body[bodyKey])
  }

  // The Hall of Fame winning-moment clip. Kept out of RESULT_FIELDS because it
  // doesn't affect accolades, so changing it shouldn't trigger a resync.
  if (body.championClipUrl !== undefined) {
    const clipUrl = normalizeOptional(body.championClipUrl)
    if (clipUrl && !/^https?:\/\//i.test(clipUrl)) {
      throw error(400, 'Winning moment clip must be an http(s) link')
    }
    updates.champion_clip_url = clipUrl
  }

  // Map pool, the presentation profile and the stage schedule all live on
  // metadata. Read the existing object once and merge onto it, so a save that
  // sends one can't drop the others (or any other metadata key the season carries).
  if (
    body.mapPool !== undefined ||
    body.mapPoolMode !== undefined ||
    body.profile !== undefined ||
    body.schedule !== undefined ||
    body.mvpName !== undefined
  ) {
    const { data: current } = await supabaseAdmin
      .from('seasons')
      .select('metadata')
      .eq('id', id)
      .maybeSingle()
    const existing =
      current?.metadata && typeof current.metadata === 'object'
        ? (current.metadata as Record<string, unknown>)
        : {}
    const merged: Record<string, unknown> = { ...existing }

    const previousMode = resolveMapPoolMode(existing)
    const mapPoolMode =
      body.mapPoolMode !== undefined ? normalizeMapPoolMode(body.mapPoolMode) : previousMode
    merged.map_pool_mode = mapPoolMode

    if (mapPoolMode === 'competitive') {
      // The rotation owns a competitive pool; the client's list is ignored.
      // Switching over starts from the current rotation rather than inheriting
      // hand-picked maps that would then never leave. After that, maps only
      // accumulate (the daily sync adds new ones, nothing is removed).
      if (previousMode !== 'competitive') {
        try {
          merged.map_pool = await fetchCompetitiveMapRotation()
        } catch (err) {
          const message = err instanceof RiotLookupError ? err.message : 'Lookup failed.'
          throw error(502, `Could not load the competitive map rotation. ${message}`)
        }
      } else {
        // Saving also picks up anything new in the rotation; if the lookup is
        // down the pool is left as is and the daily sync catches up.
        const rotation = await fetchCompetitiveMapRotation().catch(() => [] as string[])
        merged.map_pool = mergeRotationIntoPool(resolveMapPool(existing), rotation)
      }
    } else if (body.mapPool !== undefined) {
      merged.map_pool = sanitizeMapPool(body.mapPool)
    }

    if (body.profile !== undefined) {
      merged.profile = sanitizeSeasonProfile(body.profile)
    }

    if (body.schedule !== undefined) {
      merged.schedule = sanitizeSeasonSchedule(body.schedule)
    }

    // Placeholder MVP for a player who hasn't signed up yet; a picked profile wins.
    if (body.mvpName !== undefined) {
      const mvpName = normalizeOptional(body.mvpName)
      if (mvpName) merged.mvp_name = mvpName
      else delete merged.mvp_name
    }

    updates.metadata = merged
  }

  const { data, error: updateError } = await supabaseAdmin
    .from('seasons')
    .update(updates)
    .eq('id', id)
    .select(SEASON_COLUMNS)
    .single()

  if (updateError) {
    if (updateError.code === '23505') throw error(409, 'Season code already exists')
    throw error(500, 'Failed to update season')
  }

  // Results, the pinned standings or the bracket metadata may have moved.
  invalidateFinalPlacements()

  // Placement and MVP accolades follow the season's results.
  if (RESULT_FIELDS.some(([bodyKey]) => body[bodyKey] !== undefined)) {
    await syncSeasonAccoladesSafely({ seasonIds: [id] })
  }

  return json({
    success: true,
    season: data,
  })
}
