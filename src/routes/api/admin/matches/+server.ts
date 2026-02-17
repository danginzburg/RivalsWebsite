import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'

export const GET: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals.user)

  const { data: matchProposals, error: proposalsError } = await supabaseAdmin
    .from('match_proposals')
    .select(
      `
      id,
      status,
      best_of,
      proposed_start_at,
      notes,
      approval_notes,
      created_at,
      proposed_by_team_id,
      opponent_team_id,
      proposed_team:teams!match_proposals_proposed_by_team_id_fkey (id, name, tag),
      opponent_team:teams!match_proposals_opponent_team_id_fkey (id, name, tag)
    `
    )
    .order('created_at', { ascending: false })

  if (proposalsError) throw error(500, 'Failed to load match proposals')

  const { data: matches, error: matchesError } = await supabaseAdmin
    .from('matches')
    .select(
      `
      id,
      status,
      approval_status,
      best_of,
      scheduled_at,
      team_a_id,
      team_b_id,
      winner_team_id,
      team_a_score,
      team_b_score,
      team_a:teams!matches_team_a_id_fkey (id, name, tag),
      team_b:teams!matches_team_b_id_fkey (id, name, tag)
    `
    )
    .order('created_at', { ascending: false })

  if (matchesError) throw error(500, 'Failed to load matches')

  let pendingResultReports: any[] = []
  const { data: reports, error: reportsError } = await supabaseAdmin
    .from('match_result_reports')
    .select(
      'id, match_id, status, reporting_team_id, team_a_score, team_b_score, winner_team_id, notes, evidence_url, created_at'
    )
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (!reportsError) {
    pendingResultReports = reports ?? []
  }

  return json({
    matchProposals: matchProposals ?? [],
    matches: matches ?? [],
    pendingResultReports,
  })
}
