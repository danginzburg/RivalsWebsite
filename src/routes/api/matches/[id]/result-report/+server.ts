import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireProfile } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { getActiveMemberships, isCaptainLike } from '$lib/server/teams/membership'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function loadApprovedMatch(matchId: string) {
  const { data: match, error: matchError } = await supabaseAdmin
    .from('matches')
    .select('id, approval_status, status, team_a_id, team_b_id')
    .eq('id', matchId)
    .maybeSingle()

  if (matchError || !match) throw error(404, 'Match not found')
  if (match.approval_status !== 'approved') throw error(404, 'Match not found')
  return match
}

async function getReportingTeamId(
  profileId: string,
  match: { team_a_id: string; team_b_id: string }
) {
  const memberships = await getActiveMemberships(profileId)
  const eligible = memberships.filter(
    (m) => isCaptainLike(m.role) && [match.team_a_id, match.team_b_id].includes(m.team_id)
  )

  return eligible.length > 0 ? eligible[0].team_id : null
}

export const GET: RequestHandler = async ({ params }) => {
  const matchId = params.id
  if (!matchId) throw error(400, 'Missing match id')

  await loadApprovedMatch(matchId)

  const { data: pending, error: pendingError } = await supabaseAdmin
    .from('match_result_reports')
    .select(
      'id, match_id, status, reporting_team_id, team_a_score, team_b_score, winner_team_id, notes, evidence_url, created_at'
    )
    .eq('match_id', matchId)
    .eq('status', 'pending')
    .maybeSingle()

  if (pendingError) {
    // Table may not exist until migration is applied.
    return json({ pending: null })
  }

  return json({ pending: pending ?? null })
}

export const POST: RequestHandler = async ({ locals, request, params }) => {
  const matchId = params.id
  if (!matchId) throw error(400, 'Missing match id')

  const profile = await requireProfile(locals.user)
  const match = await loadApprovedMatch(matchId)

  if (['completed', 'cancelled'].includes(match.status)) {
    throw error(409, 'Match is already finished')
  }

  const reportingTeamId = await getReportingTeamId(profile.id, match)
  if (!reportingTeamId && profile.role !== 'admin') {
    throw error(403, 'Only captains/managers or admins can report results')
  }

  const { data: existingPending, error: existingError } = await supabaseAdmin
    .from('match_result_reports')
    .select('id')
    .eq('match_id', matchId)
    .eq('status', 'pending')
    .maybeSingle()

  if (existingError) {
    throw error(500, 'Failed to check existing reports')
  }
  if (existingPending) throw error(409, 'A result report is already pending admin review')

  const body = await request.json()
  const teamAScore = Number(body.teamAScore)
  const teamBScore = Number(body.teamBScore)
  const winnerTeamId = normalizeOptional(body.winnerTeamId)
  const notes = normalizeOptional(body.notes)
  const evidenceUrl = normalizeOptional(body.evidenceUrl)

  if (!Number.isFinite(teamAScore) || !Number.isFinite(teamBScore))
    throw error(400, 'Scores are required')
  if (teamAScore < 0 || teamBScore < 0) throw error(400, 'Scores must be non-negative')
  if (!winnerTeamId || ![match.team_a_id, match.team_b_id].includes(winnerTeamId)) {
    throw error(400, 'Winner team must be one of the match teams')
  }

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('match_result_reports')
    .insert({
      match_id: matchId,
      reported_by_profile_id: profile.id,
      reporting_team_id: reportingTeamId,
      team_a_score: teamAScore,
      team_b_score: teamBScore,
      winner_team_id: winnerTeamId,
      notes,
      evidence_url: evidenceUrl,
      status: 'pending',
    })
    .select(
      'id, match_id, status, reporting_team_id, team_a_score, team_b_score, winner_team_id, notes, evidence_url, created_at'
    )
    .single()

  if (insertError || !inserted) throw error(500, 'Failed to submit result report')
  return json({ success: true, report: inserted }, { status: 201 })
}
