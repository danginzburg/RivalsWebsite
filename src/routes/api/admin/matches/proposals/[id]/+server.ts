import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  const admin = await requireAdmin(locals.user)
  const proposalId = params.id
  const body = await request.json()

  const action = normalizeOptional(body.action)
  const approvalNotes = normalizeOptional(body.approvalNotes)

  if (!action) throw error(400, 'Missing action')

  const { data: proposal, error: proposalError } = await supabaseAdmin
    .from('match_proposals')
    .select(
      'id, status, proposed_by_team_id, opponent_team_id, best_of, proposed_start_at, season_id, proposed_by_profile_id'
    )
    .eq('id', proposalId)
    .single()

  if (proposalError || !proposal) throw error(404, 'Proposal not found')

  if (!['admin_review', 'accepted', 'pending'].includes(proposal.status) && action !== 'reject') {
    throw error(400, 'Proposal is not eligible for this action')
  }

  if (action === 'set_admin_review') {
    const { data: updated } = await supabaseAdmin
      .from('match_proposals')
      .update({
        status: 'admin_review',
        approval_notes: approvalNotes,
        approved_by_profile_id: admin.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', proposalId)
      .select('id, status')
      .single()
    return json({ success: true, proposal: updated })
  }

  if (action === 'reject') {
    const { data: updated } = await supabaseAdmin
      .from('match_proposals')
      .update({
        status: 'rejected',
        approval_notes: approvalNotes,
        approved_by_profile_id: admin.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', proposalId)
      .select('id, status')
      .single()
    return json({ success: true, proposal: updated })
  }

  if (action === 'approve') {
    const { data: existingMatch } = await supabaseAdmin
      .from('matches')
      .select('id')
      .eq('proposal_id', proposalId)
      .maybeSingle()

    let matchId = existingMatch?.id
    if (!matchId) {
      const { data: insertedMatch, error: insertMatchError } = await supabaseAdmin
        .from('matches')
        .insert({
          season_id: proposal.season_id,
          proposal_id: proposal.id,
          status: 'scheduled',
          approval_status: 'approved',
          best_of: proposal.best_of,
          scheduled_at: proposal.proposed_start_at,
          team_a_id: proposal.proposed_by_team_id,
          team_b_id: proposal.opponent_team_id,
          submitted_by_profile_id: proposal.proposed_by_profile_id,
          approved_by_profile_id: admin.id,
          approved_at: new Date().toISOString(),
          approval_notes: approvalNotes,
        })
        .select('id')
        .single()

      if (insertMatchError || !insertedMatch) {
        throw error(500, 'Failed to create match from proposal')
      }
      matchId = insertedMatch.id
    }

    const { data: updatedProposal } = await supabaseAdmin
      .from('match_proposals')
      .update({
        status: 'approved',
        approval_notes: approvalNotes,
        approved_by_profile_id: admin.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', proposalId)
      .select('id, status')
      .single()

    return json({ success: true, proposal: updatedProposal, matchId })
  }

  throw error(400, 'Unsupported action')
}
