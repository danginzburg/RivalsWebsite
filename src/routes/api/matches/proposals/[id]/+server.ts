import { error, json, type RequestHandler } from '@sveltejs/kit'
import { assertCanParticipate, requireProfile } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { getActiveMemberships, isCaptainLike } from '$lib/server/teams/membership'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  const profile = await requireProfile(locals.user)
  if (profile.role !== 'admin') {
    assertCanParticipate(profile)
  }
  const proposalId = params.id
  const body = await request.json()
  const action = normalizeOptional(body.action)

  if (!action) {
    throw error(400, 'Missing action')
  }

  const { data: proposal, error: proposalError } = await supabaseAdmin
    .from('match_proposals')
    .select(
      'id, status, proposed_by_team_id, opponent_team_id, approved_by_profile_id, approval_notes, best_of, proposed_start_at, notes, season_id, proposed_by_profile_id'
    )
    .eq('id', proposalId)
    .single()

  if (proposalError || !proposal) {
    throw error(404, 'Match proposal not found')
  }

  const memberships = await getActiveMemberships(profile.id)
  const roleByTeam = new Map(memberships.map((m) => [m.team_id, m.role]))
  const isProposerCaptain = isCaptainLike(roleByTeam.get(proposal.proposed_by_team_id))
  const isOpponentCaptain = isCaptainLike(roleByTeam.get(proposal.opponent_team_id))
  const isAdmin = profile.role === 'admin'

  let nextStatus: string | null = null
  if (action === 'accept') {
    if (!isOpponentCaptain && !isAdmin)
      throw error(403, 'Only opponent captains/managers can accept')
    if (proposal.status !== 'pending') throw error(400, 'Proposal is not pending')
    nextStatus = 'accepted'
  } else if (action === 'decline') {
    if (!isOpponentCaptain && !isAdmin)
      throw error(403, 'Only opponent captains/managers can decline')
    if (!['pending', 'accepted'].includes(proposal.status)) {
      throw error(400, 'Proposal cannot be declined in current state')
    }
    nextStatus = 'declined'
  } else if (action === 'withdraw') {
    if (!isProposerCaptain && !isAdmin)
      throw error(403, 'Only proposing captains/managers can withdraw')
    if (!['pending', 'accepted', 'declined'].includes(proposal.status)) {
      throw error(400, 'Proposal cannot be withdrawn in current state')
    }
    nextStatus = 'withdrawn'
  } else if (action === 'submit_admin_review') {
    if (!(isProposerCaptain || isOpponentCaptain || isAdmin)) {
      throw error(403, 'Only captains/managers can submit review')
    }
    if (proposal.status !== 'accepted')
      throw error(400, 'Only accepted proposals can be sent to admin review')
    nextStatus = 'admin_review'
  } else {
    throw error(400, 'Unsupported action')
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('match_proposals')
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq('id', proposalId)
    .select('id, status, proposed_by_team_id, opponent_team_id, best_of, proposed_start_at')
    .single()

  if (updateError || !updated) {
    throw error(500, 'Failed to update proposal')
  }

  return json({ success: true, proposal: updated })
}
