import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import {
  computeSignupValue,
  normalizeDiscordHandle,
  normalizeOptional,
  parseScore,
} from '$lib/server/signups'

const SELECT_COLUMNS = `
  id,
  profile_id,
  season_id,
  display_name,
  discord_handle,
  tracker_links,
  current_rank,
  peak_rank,
  tracker_current_score,
  tracker_peak_score,
  computed_value,
  manual_value_override,
  status,
  admin_notes,
  created_at,
  updated_at
`

export const GET: RequestHandler = async ({ locals, url }) => {
  await requireAdmin(locals.user)

  const status = url.searchParams.get('status') ?? 'all'
  const seasonId = url.searchParams.get('seasonId')

  let query = supabaseAdmin
    .from('player_signups')
    .select(SELECT_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(500)

  if (status !== 'all') query = query.eq('status', status)
  if (seasonId === '__none__') query = query.is('season_id', null)
  else if (seasonId) query = query.eq('season_id', seasonId)

  const { data: signups, error: listError } = await query
  if (listError) throw error(500, 'Failed to load signups')

  const rows = signups ?? []
  if (rows.length === 0) return json({ signups: [] })

  // Attach the player's profile so the UI can show a stable identity even
  // when the submitted display name differs.
  const profileIds = Array.from(new Set(rows.map((r) => r.profile_id)))
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, riot_id_base, email')
    .in('id', profileIds)

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]))

  return json({
    signups: rows.map((row) => {
      const profile = profileById.get(row.profile_id)
      return {
        ...row,
        profile: {
          id: row.profile_id,
          name:
            profile?.riot_id_base ?? profile?.display_name ?? profile?.email ?? 'Unknown player',
          email: profile?.email ?? null,
        },
      }
    }),
  })
}

export const PATCH: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const id = normalizeOptional(body.id)
  if (!id) throw error(400, 'Signup id is required')

  const { data: existing } = await supabaseAdmin
    .from('player_signups')
    .select('id, profile_id, current_rank, peak_rank, tracker_current_score, tracker_peak_score')
    .eq('id', id)
    .maybeSingle()

  if (!existing) throw error(404, 'Signup not found')

  const currentRank = normalizeOptional(body.currentRank) ?? existing.current_rank
  const peakRank = normalizeOptional(body.peakRank) ?? existing.peak_rank

  // `undefined` leaves a score untouched; an explicit null clears it.
  const trackerCurrentScore =
    body.trackerCurrentScore === undefined
      ? existing.tracker_current_score
      : parseScore(body.trackerCurrentScore)
  const trackerPeakScore =
    body.trackerPeakScore === undefined
      ? existing.tracker_peak_score
      : parseScore(body.trackerPeakScore)

  const computedValue = computeSignupValue({
    current_rank: currentRank,
    peak_rank: peakRank,
    tracker_current_score: trackerCurrentScore,
    tracker_peak_score: trackerPeakScore,
  })

  const manualOverride =
    body.manualValueOverride === undefined || body.manualValueOverride === null
      ? null
      : parseScore(body.manualValueOverride)

  const status = normalizeOptional(body.status)
  if (status && !['pending', 'approved', 'rejected'].includes(status)) {
    throw error(400, 'status must be pending, approved, or rejected')
  }

  const updates: Record<string, unknown> = {
    current_rank: currentRank,
    peak_rank: peakRank,
    tracker_current_score: trackerCurrentScore,
    tracker_peak_score: trackerPeakScore,
    computed_value: computedValue,
    manual_value_override: manualOverride,
    admin_notes: normalizeOptional(body.adminNotes),
  }

  if (body.displayName !== undefined) {
    updates.display_name = normalizeOptional(body.displayName)
  }
  if (body.discordHandle !== undefined) {
    updates.discord_handle = normalizeDiscordHandle(body.discordHandle)
  }

  if (status) {
    updates.status = status
    updates.reviewed_by_profile_id = admin.id
    updates.reviewed_at = new Date().toISOString()
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('player_signups')
    .update(updates)
    .eq('id', id)
    .select(SELECT_COLUMNS)
    .single()

  if (updateError) {
    console.error('Failed to update signup:', updateError)
    throw error(500, 'Failed to update signup')
  }

  // Approving publishes the contact details onto the player's profile.
  if (status === 'approved') {
    await supabaseAdmin
      .from('profiles')
      .update({
        discord_handle: updated.discord_handle,
        tracker_links: updated.tracker_links ?? [],
      })
      .eq('id', existing.profile_id)
  }

  // Rejecting or reverting to pending retracts them again.
  if (status === 'rejected' || status === 'pending') {
    await supabaseAdmin
      .from('profiles')
      .update({ discord_handle: null, tracker_links: [] })
      .eq('id', existing.profile_id)
  }

  return json({ success: true, signup: updated })
}

export const DELETE: RequestHandler = async ({ locals, url }) => {
  await requireAdmin(locals.user)

  const id = url.searchParams.get('id')
  if (!id) throw error(400, 'Signup id is required')

  const { error: deleteError } = await supabaseAdmin.from('player_signups').delete().eq('id', id)

  if (deleteError) throw error(500, 'Failed to delete signup')

  return json({ success: true })
}
