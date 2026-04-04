import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { buildTeamMatcher, getApprovedTeamsForImports } from '$lib/server/imports/matching'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseInteger(value: unknown, fieldName: string) {
  const n = Number(value)
  if (!Number.isInteger(n)) throw error(400, `${fieldName} must be an integer`)
  return n
}

export const POST: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const rows = Array.isArray(body.rows) ? body.rows : []
  const seasonId = normalizeOptional(body.seasonId)
  const split = normalizeOptional(body.split) ?? 'main'
  const asOfDate = normalizeOptional(body.asOfDate)
  const sourceFilename = normalizeOptional(body.sourceFilename) ?? 'leaderboard.csv'
  const displayName = normalizeOptional(body.displayName) ?? sourceFilename

  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate ?? '')) throw error(400, 'asOfDate must be YYYY-MM-DD')
  if (rows.length === 0) throw error(400, 'No leaderboard rows provided')
  if (rows.length > 200) throw error(400, 'Too many leaderboard rows provided')

  let season: { id: string; name: string } | null = null
  if (seasonId) {
    const { data: seasonRow, error: seasonError } = await supabaseAdmin
      .from('seasons')
      .select('id, name')
      .eq('id', seasonId)
      .maybeSingle()

    if (seasonError || !seasonRow) throw error(404, 'Season not found')
    season = seasonRow
  }

  const teams = await getApprovedTeamsForImports()
  const matcher = buildTeamMatcher(teams)
  const seenTeamIds = new Set<string>()
  const unresolved: string[] = []

  const resolvedRows = rows.map((row: any, index: number) => {
    const teamCode = normalizeOptional(row.team)
    if (!teamCode) throw error(400, `Row ${index + 1} is missing TEAM`)

    const team = matcher.byLeaderboardTag(teamCode)
    if (!team) {
      unresolved.push(teamCode)
      return null
    }

    if (seenTeamIds.has(team.id)) {
      throw error(400, `Duplicate team in import: ${teamCode}`)
    }
    seenTeamIds.add(team.id)

    return {
      team_id: team.id,
      matches_played: parseInteger(row.series_played, 'SERIES PLAYED'),
      wins: parseInteger(row.series_wins, 'SERIES WINS'),
      losses: parseInteger(row.series_losses, 'SERIES LOSSES'),
      map_wins: parseInteger(row.map_wins, 'MAP WINS'),
      map_losses: parseInteger(row.map_losses, 'MAP LOSSES'),
      points: parseInteger(row.points, 'POINTS'),
      round_diff: parseInteger(row.round_diff, 'ROUND DIFF'),
      rank: index + 1,
      metadata: {
        source_team_code: teamCode,
        source_maps_played: parseInteger(row.maps_played, 'MAPS PLAYED'),
      },
    }
  })

  const matchedRows = resolvedRows.filter(Boolean)
  if (matchedRows.length === 0) throw error(400, 'No teams in this import matched approved teams')

  const batchId = crypto.randomUUID()
  const importedAt = new Date().toISOString()

  const { error: batchError } = await supabaseAdmin.from('stat_import_batches').insert({
    id: batchId,
    uploaded_by_profile_id: admin.id,
    season_id: seasonId,
    source_filename: sourceFilename,
    display_name: displayName,
    import_kind: 'aggregate',
    week_label: null,
    status: 'applied',
    dry_run: false,
    row_count: rows.length,
    accepted_count: matchedRows.length,
    rejected_count: unresolved.length,
    approved_by_profile_id: admin.id,
    approved_at: importedAt,
    metadata: {
      import_type: 'leaderboard_entries',
      split,
      as_of_date: asOfDate,
      season_name: season?.name ?? null,
      unmatched_teams: unresolved,
    },
  })

  if (batchError) throw error(500, batchError.message || 'Failed to create import batch')

  let deleteQuery = supabaseAdmin
    .from('leaderboard_entries')
    .delete()
    .eq('split', split)
    .eq('as_of_date', asOfDate)

  deleteQuery = seasonId ? deleteQuery.eq('season_id', seasonId) : deleteQuery.is('season_id', null)

  const { error: deleteError } = await deleteQuery

  if (deleteError)
    throw error(500, deleteError.message || 'Failed to clear existing leaderboard rows')

  const rowsToInsert = matchedRows.map((row: any) => ({
    season_id: seasonId,
    split,
    as_of_date: asOfDate,
    team_id: row.team_id,
    matches_played: row.matches_played,
    wins: row.wins,
    losses: row.losses,
    map_wins: row.map_wins,
    map_losses: row.map_losses,
    round_wins: 0,
    round_losses: 0,
    round_diff: row.round_diff,
    points: row.points,
    tiebreaker_score: row.round_diff,
    rank: row.rank,
    import_batch_id: batchId,
    metadata: row.metadata,
  }))

  const { error: insertError } = await supabaseAdmin
    .from('leaderboard_entries')
    .insert(rowsToInsert)
  if (insertError) throw error(500, insertError.message || 'Failed to insert leaderboard rows')

  return json({
    success: true,
    imported: rowsToInsert.length,
    skipped: unresolved.length,
    unmatchedTeams: unresolved,
    batchId,
  })
}
