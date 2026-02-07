import { error, json, type RequestHandler } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { requireProfile } from '$lib/server/auth/profile'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const GET: RequestHandler = async ({ locals }) => {
  const profile = await requireProfile(locals.user)

  const { data, error: fetchError } = await supabaseAdmin
    .from('team_invites')
    .select(
      `
      id,
      status,
      role,
      message,
      created_at,
      team_id,
      teams (
        id,
        name,
        tag,
        approval_status,
        logo_path
      )
    `
    )
    .eq('invited_profile_id', profile.id)
    .in('status', ['pending', 'accepted'])
    .order('created_at', { ascending: false })

  if (fetchError) {
    throw error(500, 'Failed to load team invites')
  }

  return json({ invites: data ?? [] })
}

export const PATCH: RequestHandler = async ({ locals, request }) => {
  const profile = await requireProfile(locals.user)
  const body = await request.json()

  const inviteId = normalizeOptional(body.inviteId)
  const action = normalizeOptional(body.action)

  if (!inviteId) {
    throw error(400, 'Missing inviteId')
  }
  if (action !== 'accept' && action !== 'decline') {
    throw error(400, "Action must be 'accept' or 'decline'")
  }

  const { data: invite, error: inviteError } = await supabaseAdmin
    .from('team_invites')
    .select('id, team_id, status, invited_profile_id')
    .eq('id', inviteId)
    .eq('invited_profile_id', profile.id)
    .single()

  if (inviteError || !invite) {
    throw error(404, 'Invite not found')
  }

  if (invite.status !== 'pending') {
    throw error(400, 'Invite is no longer pending')
  }

  const newStatus = action === 'accept' ? 'accepted' : 'declined'

  const { error: updateError } = await supabaseAdmin
    .from('team_invites')
    .update({
      status: newStatus,
      responded_at: new Date().toISOString(),
    })
    .eq('id', inviteId)

  if (updateError) {
    throw error(500, 'Failed to update invite')
  }

  if (action === 'accept') {
    const { data: team } = await supabaseAdmin
      .from('teams')
      .select('id, approval_status')
      .eq('id', invite.team_id)
      .maybeSingle()

    if (team?.approval_status === 'approved') {
      await supabaseAdmin.from('team_memberships').insert({
        team_id: invite.team_id,
        profile_id: profile.id,
        role: 'player',
        is_active: true,
      })
    }
  }

  return json({ success: true, status: newStatus })
}
