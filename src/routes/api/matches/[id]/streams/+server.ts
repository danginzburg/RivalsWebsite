import { error, json, type RequestHandler } from '@sveltejs/kit'
import { assertCanParticipate, requireProfile } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { getActiveMemberships, isCaptainLike } from '$lib/server/teams/membership'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function canManageMatch(profileId: string, role: string | undefined, matchId: string) {
  if (role === 'admin') return true
  if (role === 'restricted' || role === 'banned') return false

  const { data: match } = await supabaseAdmin
    .from('matches')
    .select('id, team_a_id, team_b_id')
    .eq('id', matchId)
    .maybeSingle()

  if (!match) return false

  const memberships = await getActiveMemberships(profileId)
  return memberships.some(
    (m) => [match.team_a_id, match.team_b_id].includes(m.team_id) && isCaptainLike(m.role)
  )
}

export const GET: RequestHandler = async ({ params }) => {
  const matchId = params.id
  if (!matchId) throw error(400, 'Missing match id')

  const { data, error: fetchError } = await supabaseAdmin
    .from('match_streams')
    .select('id, platform, stream_url, is_primary, status, created_at')
    .eq('match_id', matchId)
    .order('is_primary', { ascending: false })

  if (fetchError) throw error(500, 'Failed to load streams')
  return json({ streams: data ?? [] })
}

export const POST: RequestHandler = async ({ locals, request, params }) => {
  const matchId = params.id
  if (!matchId) throw error(400, 'Missing match id')

  const profile = await requireProfile(locals.user)
  assertCanParticipate(profile)
  const allowed = await canManageMatch(profile.id, profile.role, matchId)
  if (!allowed) throw error(403, 'Only captains/managers or admins can manage streams')

  const body = await request.json()
  const platform = normalizeOptional(body.platform) ?? 'twitch'
  const streamUrl = normalizeOptional(body.streamUrl)
  const isPrimary = Boolean(body.isPrimary)

  if (!streamUrl) throw error(400, 'Stream URL is required')

  if (isPrimary) {
    await supabaseAdmin
      .from('match_streams')
      .update({ is_primary: false })
      .eq('match_id', matchId)
      .eq('is_primary', true)
  }

  const { data: stream, error: insertError } = await supabaseAdmin
    .from('match_streams')
    .insert({
      match_id: matchId,
      platform,
      stream_url: streamUrl,
      is_primary: isPrimary,
      status: 'scheduled',
      added_by_profile_id: profile.id,
    })
    .select('id, platform, stream_url, is_primary, status, created_at')
    .single()

  if (insertError || !stream) throw error(500, 'Failed to add stream')
  return json({ success: true, stream }, { status: 201 })
}

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  const matchId = params.id
  if (!matchId) throw error(400, 'Missing match id')

  const profile = await requireProfile(locals.user)
  assertCanParticipate(profile)
  const allowed = await canManageMatch(profile.id, profile.role, matchId)
  if (!allowed) throw error(403, 'Only captains/managers or admins can manage streams')

  const body = await request.json()
  const streamId = normalizeOptional(body.streamId)
  const status = normalizeOptional(body.status)
  const isPrimary = body.isPrimary === true

  if (!streamId) throw error(400, 'streamId is required')

  if (isPrimary) {
    await supabaseAdmin
      .from('match_streams')
      .update({ is_primary: false })
      .eq('match_id', matchId)
      .eq('is_primary', true)
  }

  const payload: Record<string, unknown> = {}
  if (status && ['scheduled', 'live', 'ended'].includes(status)) payload.status = status
  if (body.isPrimary !== undefined) payload.is_primary = Boolean(body.isPrimary)

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('match_streams')
    .update(payload)
    .eq('id', streamId)
    .eq('match_id', matchId)
    .select('id, platform, stream_url, is_primary, status, created_at')
    .single()

  if (updateError || !updated) throw error(500, 'Failed to update stream')
  return json({ success: true, stream: updated })
}

export const DELETE: RequestHandler = async ({ locals, request, params }) => {
  const matchId = params.id
  if (!matchId) throw error(400, 'Missing match id')

  const profile = await requireProfile(locals.user)
  assertCanParticipate(profile)
  const allowed = await canManageMatch(profile.id, profile.role, matchId)
  if (!allowed) throw error(403, 'Only captains/managers or admins can manage streams')

  const body = await request.json()
  const streamId = normalizeOptional(body.streamId)
  if (!streamId) throw error(400, 'streamId is required')

  const { error: deleteError } = await supabaseAdmin
    .from('match_streams')
    .delete()
    .eq('id', streamId)
    .eq('match_id', matchId)

  if (deleteError) throw error(500, 'Failed to remove stream')
  return json({ success: true })
}
