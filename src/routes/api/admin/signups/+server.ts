import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import {
  computeSignupValue,
  normalizeDiscordHandle,
  normalizeOptional,
  parseAdjustment,
  parseScore,
} from '$lib/server/signups'
import { loadRatingFor, loadRatingsByName, ratingNameKey } from '$lib/server/signups/ratings'
import { createNotification } from '$lib/server/notifications'
import { syncPrimaryRiotName } from '$lib/server/players/riot-accounts'
import { withSignupRiotIds } from '$lib/server/signups/riot-ids'

const SELECT_COLUMNS = `
  id,
  profile_id,
  season_id,
  discord_handle,
  tracker_links,
  current_rank,
  peak_rank,
  computed_value,
  manual_value_override,
  manual_adjustment,
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

  if (!signups?.length) return json({ signups: [] })
  const rows = await withSignupRiotIds(signups)

  // Attach the player's profile so the UI can show a stable identity even
  // when the submitted display name differs.
  const profileIds = Array.from(new Set(rows.map((r) => r.profile_id)))
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, email')
    .in('id', profileIds)

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]))
  // The rating is shown in the score breakdown; a missing one means no bonus.
  const ratings = await loadRatingsByName(rows.map((r) => r.display_name))

  return json({
    signups: rows.map((row) => {
      const profile = profileById.get(row.profile_id)
      return {
        ...row,
        rating: ratings.get(ratingNameKey(row.display_name)) ?? null,
        profile: {
          id: row.profile_id,
          name: profile?.display_name ?? profile?.email ?? 'Unknown player',
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
    .select('id, profile_id, current_rank, peak_rank, manual_adjustment')
    .eq('id', id)
    .maybeSingle()

  if (!existing) throw error(404, 'Signup not found')
  const [{ display_name: currentRiotName }] = await withSignupRiotIds([existing])

  const currentRank = normalizeOptional(body.currentRank) ?? existing.current_rank
  const peakRank = normalizeOptional(body.peakRank) ?? existing.peak_rank

  // The rating is matched by Riot name, so use the name this save leaves.
  const displayName =
    body.displayName !== undefined ? normalizeOptional(body.displayName) : currentRiotName

  const computedValue = computeSignupValue({
    current_rank: currentRank,
    peak_rank: peakRank,
    rating: await loadRatingFor(displayName),
  })

  const manualOverride =
    body.manualValueOverride === undefined || body.manualValueOverride === null
      ? null
      : parseScore(body.manualValueOverride)

  // `undefined` leaves the adjustment alone; blank clears it to 0.
  const manualAdjustment =
    body.manualAdjustment === undefined
      ? existing.manual_adjustment
      : parseAdjustment(body.manualAdjustment)
  if (manualAdjustment == null) throw error(400, 'Adjustment must be a number')

  const status = normalizeOptional(body.status)
  if (status && !['pending', 'approved', 'rejected'].includes(status)) {
    throw error(400, 'status must be pending, approved, or rejected')
  }

  const updates: Record<string, unknown> = {
    current_rank: currentRank,
    peak_rank: peakRank,
    computed_value: computedValue,
    manual_value_override: manualOverride,
    manual_adjustment: manualAdjustment,
    admin_notes: normalizeOptional(body.adminNotes),
  }

  // The signup's Riot name is the player's primary Riot account; correcting it
  // here corrects it everywhere.
  if (displayName && displayName !== currentRiotName) {
    await syncPrimaryRiotName(existing.profile_id, displayName)
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

  // Let the player know an admin acted on their signup.
  if (status === 'approved') {
    await createNotification({
      recipientProfileId: existing.profile_id,
      type: 'signup_approved',
      title: 'Your signup was approved',
      body: 'You are in — see your registration on your account page.',
      link: '/account',
      actorProfileId: admin.id,
    })
  } else if (status === 'rejected') {
    await createNotification({
      recipientProfileId: existing.profile_id,
      type: 'signup_rejected',
      title: 'Your signup was not approved',
      body: updated.admin_notes ? `Note from an admin: ${updated.admin_notes}` : null,
      link: '/account',
      actorProfileId: admin.id,
    })
  }

  // Contact details are published straight from the approved signup (the
  // player page reads it), so approving or rejecting needs no profile write.
  const [signup] = await withSignupRiotIds([updated])
  return json({ success: true, signup })
}

export const DELETE: RequestHandler = async ({ locals, url }) => {
  await requireAdmin(locals.user)

  const id = url.searchParams.get('id')
  if (!id) throw error(400, 'Signup id is required')

  const { error: deleteError } = await supabaseAdmin.from('player_signups').delete().eq('id', id)

  if (deleteError) throw error(500, 'Failed to delete signup')

  return json({ success: true })
}
