import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseScheduledAt(value: unknown): string | null {
  const raw = normalizeOptional(value)
  if (!raw) return null

  // <input type="datetime-local"> is interpreted in the viewer's local timezone.
  const d = new Date(raw)
  if (!Number.isFinite(d.getTime())) throw error(400, 'Invalid scheduledAt')
  return d.toISOString()
}

function parseMapVetoes(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  const admin = await requireAdmin(locals.user)
  const matchId = params.id
  const body = await request.json()

  const action = normalizeOptional(body.action)
  if (!action) throw error(400, 'Missing action')

  const { data: match, error: matchError } = await supabaseAdmin
    .from('matches')
    .select('id, team_a_id, team_b_id, status, team_a_score, team_b_score')
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

  if (action === 'update') {
    const teamAId = normalizeOptional(body.teamAId)
    const teamBId = normalizeOptional(body.teamBId)
    const bestOf = Number(body.bestOf ?? 3)
    const status = normalizeOptional(body.status)
    const scheduledAt = parseScheduledAt(body.scheduledAt)
    const teamAScore = Number(body.teamAScore ?? match.team_a_score ?? 0)
    const teamBScore = Number(body.teamBScore ?? match.team_b_score ?? 0)
    const winnerTeamId = normalizeOptional(body.winnerTeamId)
    const youtubeVodUrl = normalizeOptional(body.youtubeVodUrl)
    const mapVetoes = parseMapVetoes(body.mapVetoes)

    if (!teamAId || !teamBId) throw error(400, 'Both teams are required')
    if (teamAId === teamBId) throw error(400, 'Teams must be different')
    if (![3, 5].includes(bestOf)) throw error(400, 'bestOf must be one of 3 or 5')
    if (status && !['scheduled', 'live', 'completed', 'cancelled'].includes(status)) {
      throw error(400, 'Invalid match status')
    }

    if (winnerTeamId && ![teamAId, teamBId].includes(winnerTeamId)) {
      throw error(400, 'Winner team must be one of the selected teams')
    }

    const { data: matchWithMetadata } = await supabaseAdmin
      .from('matches')
      .select('metadata')
      .eq('id', matchId)
      .maybeSingle()

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('matches')
      .update({
        team_a_id: teamAId,
        team_b_id: teamBId,
        best_of: bestOf,
        status: status ?? match.status,
        scheduled_at: scheduledAt,
        team_a_score: Number.isFinite(teamAScore) ? teamAScore : 0,
        team_b_score: Number.isFinite(teamBScore) ? teamBScore : 0,
        winner_team_id: winnerTeamId,
        ended_at: (status ?? match.status) === 'completed' ? new Date().toISOString() : null,
        metadata: {
          ...(matchWithMetadata?.metadata ?? {}),
          youtube_vod_url: youtubeVodUrl,
          map_vetoes: mapVetoes,
        },
        approved_by_profile_id: admin.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', matchId)
      .select(
        'id, status, team_a_id, team_b_id, winner_team_id, team_a_score, team_b_score, scheduled_at'
      )
      .single()

    if (updateError || !updated) throw error(500, 'Failed to update match')
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

export const DELETE: RequestHandler = async ({ locals, params }) => {
  await requireAdmin(locals.user)

  const matchId = params.id
  const { error: deleteError } = await supabaseAdmin.from('matches').delete().eq('id', matchId)
  if (deleteError) throw error(500, 'Failed to delete match')

  return json({ success: true })
}
