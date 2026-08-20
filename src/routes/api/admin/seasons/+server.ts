import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { getSeasonLogoUrl } from '$lib/server/seasons/logo'

const SEASON_COLUMNS = `
  id,
  code,
  name,
  starts_on,
  ends_on,
  is_active,
  metadata,
  logo_path,
  summary,
  winner_team_id,
  runner_up_team_id,
  mvp_profile_id,
  final_leaderboard_batch_id,
  created_at
`

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
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

  // Season results are only written when the caller actually sent them.
  // A payload that omits a field leaves it alone rather than clearing it, so
  // a partial save (renaming a season, toggling active) cannot wipe results.
  const RESULT_FIELDS = [
    ['summary', 'summary'],
    ['winnerTeamId', 'winner_team_id'],
    ['runnerUpTeamId', 'runner_up_team_id'],
    ['mvpProfileId', 'mvp_profile_id'],
    ['finalLeaderboardBatchId', 'final_leaderboard_batch_id'],
  ] as const

  for (const [bodyKey, column] of RESULT_FIELDS) {
    if (body[bodyKey] !== undefined) updates[column] = normalizeOptional(body[bodyKey])
  }

  // Map pool lives on metadata. Merge onto the existing object so a save that
  // sends the pool cannot drop other metadata keys the season carries.
  if (body.mapPool !== undefined) {
    const mapPool = Array.isArray(body.mapPool)
      ? body.mapPool
          .map((name: unknown) => (typeof name === 'string' ? name.trim() : ''))
          .filter((name: string) => name.length > 0)
      : []

    const { data: current } = await supabaseAdmin
      .from('seasons')
      .select('metadata')
      .eq('id', id)
      .maybeSingle()
    const existing =
      current?.metadata && typeof current.metadata === 'object'
        ? (current.metadata as Record<string, unknown>)
        : {}
    updates.metadata = { ...existing, map_pool: mapPool }
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

  return json({
    success: true,
    season: data,
  })
}
