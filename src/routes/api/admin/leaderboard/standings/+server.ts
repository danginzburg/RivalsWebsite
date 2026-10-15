import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { logAdminAction } from '$lib/server/audit/admin-actions'
import { calculateSeasonStandings, publishSeasonStandings } from '$lib/server/leaderboard/computed'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseDelta(value: unknown, fieldName: string): number {
  if (value === undefined || value === null || value === '') return 0
  const n = Number(value)
  if (!Number.isInteger(n)) throw error(400, `${fieldName} must be a whole number`)
  if (Math.abs(n) > 1000) throw error(400, `${fieldName} is out of range`)
  return n
}

function parseRankOverride(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) throw error(400, 'Pinned rank must be a positive whole number')
  return n
}

async function requireSeason(seasonId: string | null) {
  if (!seasonId) throw error(400, 'seasonId is required')
  const { data } = await supabaseAdmin.from('seasons').select('id').eq('id', seasonId).maybeSingle()
  if (!data) throw error(404, 'Season not found')
  return seasonId
}

/** Preview the calculation without publishing it. */
export const GET: RequestHandler = async ({ locals, url }) => {
  await requireAdmin(locals.user)
  const seasonId = await requireSeason(normalizeOptional(url.searchParams.get('seasonId')))
  return json(await calculateSeasonStandings(seasonId))
}

/** Recalculate from the matches and publish as the season's standings. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))
  const seasonId = await requireSeason(normalizeOptional(body.seasonId))

  const standings = await publishSeasonStandings(seasonId, admin.id)

  await logAdminAction({
    adminProfileId: admin.id,
    actionType: 'leaderboard_recalculated',
    targetTable: 'stat_import_batches',
    targetId: standings.batch?.id ?? seasonId,
    details: { seasonId, matchCount: standings.matchCount },
  })

  return json({ success: true, standings })
}

/**
 * Save one team's manual correction and republish. A correction with nothing
 * in it is deleted, which returns the team to its calculated line.
 */
export const PUT: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))
  const seasonId = await requireSeason(normalizeOptional(body.seasonId))
  const teamId = normalizeOptional(body.teamId)
  if (!teamId) throw error(400, 'teamId is required')

  const { data: team } = await supabaseAdmin
    .from('teams')
    .select('id, season_id')
    .eq('id', teamId)
    .maybeSingle()
  if (!team || team.season_id !== seasonId) throw error(400, 'Team is not in this season')

  const adjustment = {
    wins: parseDelta(body.wins, 'Series wins'),
    losses: parseDelta(body.losses, 'Series losses'),
    map_wins: parseDelta(body.map_wins, 'Map wins'),
    map_losses: parseDelta(body.map_losses, 'Map losses'),
    round_diff: parseDelta(body.round_diff, 'Round diff'),
    points: parseDelta(body.points, 'Points'),
    rank_override: parseRankOverride(body.rank_override),
    note: normalizeOptional(body.note),
  }

  const isEmpty =
    adjustment.wins === 0 &&
    adjustment.losses === 0 &&
    adjustment.map_wins === 0 &&
    adjustment.map_losses === 0 &&
    adjustment.round_diff === 0 &&
    adjustment.points === 0 &&
    adjustment.rank_override === null &&
    adjustment.note === null

  if (isEmpty) {
    const { error: deleteError } = await supabaseAdmin
      .from('leaderboard_adjustments')
      .delete()
      .eq('season_id', seasonId)
      .eq('team_id', teamId)
    if (deleteError) throw error(500, deleteError.message || 'Failed to clear correction')
  } else {
    const { error: upsertError } = await supabaseAdmin.from('leaderboard_adjustments').upsert(
      {
        season_id: seasonId,
        team_id: teamId,
        ...adjustment,
        updated_by_profile_id: admin.id,
      },
      { onConflict: 'season_id,team_id' }
    )
    if (upsertError) throw error(500, upsertError.message || 'Failed to save correction')
  }

  await logAdminAction({
    adminProfileId: admin.id,
    actionType: isEmpty ? 'leaderboard_adjustment_cleared' : 'leaderboard_adjustment_saved',
    targetTable: 'leaderboard_adjustments',
    targetId: teamId,
    details: { seasonId, ...adjustment },
  })

  const standings = await publishSeasonStandings(seasonId, admin.id)
  return json({ success: true, standings })
}
