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
  const matchId = params.id
  const body = await request.json()

  const action = normalizeOptional(body.action)
  if (!action) throw error(400, 'Missing action')

  const { data: match, error: matchError } = await supabaseAdmin
    .from('matches')
    .select('id, team_a_id, team_b_id, status')
    .eq('id', matchId)
    .single()

  if (matchError || !match) throw error(404, 'Match not found')

  if (action === 'cancel') {
    const { data: updated } = await supabaseAdmin
      .from('matches')
      .update({
        status: 'cancelled',
        approval_status: 'approved',
        approved_by_profile_id: admin.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', matchId)
      .select('id, status, approval_status')
      .single()
    return json({ success: true, match: updated })
  }

  if (action === 'finalize') {
    const teamAScore = Number(body.teamAScore)
    const teamBScore = Number(body.teamBScore)
    const winnerTeamId = normalizeOptional(body.winnerTeamId)

    if (!Number.isFinite(teamAScore) || !Number.isFinite(teamBScore)) {
      throw error(400, 'Scores are required')
    }

    if (!winnerTeamId || ![match.team_a_id, match.team_b_id].includes(winnerTeamId)) {
      throw error(400, 'Winner team must be one of the match teams')
    }

    const { data: updated } = await supabaseAdmin
      .from('matches')
      .update({
        status: 'completed',
        approval_status: 'approved',
        winner_team_id: winnerTeamId,
        team_a_score: teamAScore,
        team_b_score: teamBScore,
        ended_at: new Date().toISOString(),
        approved_by_profile_id: admin.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', matchId)
      .select('id, status, winner_team_id, team_a_score, team_b_score')
      .single()

    return json({ success: true, match: updated })
  }

  throw error(400, 'Unsupported action')
}
