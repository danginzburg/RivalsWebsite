import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import {
  buildProfileMatcher,
  buildTeamMatcher,
  getApprovedTeamsForImports,
  getProfilesForImports,
  parseMatchCsvDate,
  rebuildPlayerMatchStats,
} from '$lib/server/imports/matching'

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

function dayRange(isoString: string) {
  const date = new Date(isoString)
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0)
  )
  const end = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999)
  )
  return { start: start.toISOString(), end: end.toISOString() }
}

function inferBestOf(mapCount: number) {
  if (mapCount >= 5) return 5
  if (mapCount >= 3) return 3
  return 1
}

export const POST: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const maps = Array.isArray(body.maps) ? body.maps : []

  const normalizedMaps = (
    maps.length > 0
      ? maps
      : [
          {
            sourceFilename: normalizeOptional(body.sourceFilename) ?? 'match.csv',
            mapName: normalizeOptional(body.mapName),
            scheduledAt: normalizeOptional(body.scheduledAt),
            teamAName: normalizeOptional(body.teamAName),
            teamBName: normalizeOptional(body.teamBName),
            teamARounds: body.teamARounds,
            teamBRounds: body.teamBRounds,
            playerRows: Array.isArray(body.playerRows) ? body.playerRows : [],
          },
        ]
  ) as any[]

  if (normalizedMaps.length === 0) throw error(400, 'No map rows provided')

  const firstMap = normalizedMaps[0]
  const teamAName = normalizeOptional(firstMap.teamAName)
  const teamBName = normalizeOptional(firstMap.teamBName)
  const scheduledAt = parseMatchCsvDate(normalizeOptional(firstMap.scheduledAt) ?? '')
  const displayName =
    normalizeOptional(body.displayName) ??
    normalizeOptional(firstMap.displayName) ??
    normalizeOptional(firstMap.sourceFilename) ??
    'match-import'
  const primarySourceFilename = normalizeOptional(firstMap.sourceFilename) ?? 'match.csv'
  const bestOf = [1, 3, 5, 7].includes(Number(body.bestOf))
    ? Number(body.bestOf)
    : inferBestOf(normalizedMaps.length)

  if (!teamAName || !teamBName) throw error(400, 'Both team names are required')
  if (teamAName === teamBName) throw error(400, 'Teams must be different')

  for (const [index, map] of normalizedMaps.entries()) {
    if (
      normalizeOptional(map.teamAName) !== teamAName ||
      normalizeOptional(map.teamBName) !== teamBName
    ) {
      throw error(400, `Map ${index + 1} teams do not match the rest of the series`)
    }
    if (!Array.isArray(map.playerRows) || map.playerRows.length === 0) {
      throw error(400, `Map ${index + 1} has no player rows`)
    }
  }

  const [teams, profiles] = await Promise.all([
    getApprovedTeamsForImports(),
    getProfilesForImports(),
  ])
  const teamMatcher = buildTeamMatcher(teams)
  const profileMatcher = buildProfileMatcher(profiles)

  const importedTeamA = teamMatcher.byMatchName(teamAName)
  const importedTeamB = teamMatcher.byMatchName(teamBName)
  if (!importedTeamA || !importedTeamB) {
    throw error(
      400,
      `Unmatched teams: ${[!importedTeamA ? teamAName : null, !importedTeamB ? teamBName : null].filter(Boolean).join(', ')}`
    )
  }
  if (importedTeamA.id === importedTeamB.id)
    throw error(400, 'Teams must resolve to different teams')

  const { start, end } = dayRange(scheduledAt)
  const { data: existingMatches, error: existingMatchesError } = await supabaseAdmin
    .from('matches')
    .select('id, team_a_id, team_b_id, metadata, status, scheduled_at')
    .or(
      `and(team_a_id.eq.${importedTeamA.id},team_b_id.eq.${importedTeamB.id}),and(team_a_id.eq.${importedTeamB.id},team_b_id.eq.${importedTeamA.id})`
    )
    .gte('scheduled_at', start)
    .lte('scheduled_at', end)

  if (existingMatchesError) throw error(500, 'Failed to check existing matches')

  let match = (existingMatches ?? [])[0] as any
  if (!match) {
    const { data: createdMatch, error: createMatchError } = await supabaseAdmin
      .from('matches')
      .insert({
        status: 'completed',
        approval_status: 'approved',
        best_of: bestOf,
        scheduled_at: scheduledAt,
        ended_at: scheduledAt,
        team_a_id: importedTeamA.id,
        team_b_id: importedTeamB.id,
        team_a_score: 0,
        team_b_score: 0,
        winner_team_id: null,
        submitted_by_profile_id: admin.id,
        approved_by_profile_id: admin.id,
        approved_at: new Date().toISOString(),
        metadata: {
          imported_from_csv: true,
          has_series_result: true,
          match_import_name_a: teamAName,
          match_import_name_b: teamBName,
        },
      })
      .select('id, team_a_id, team_b_id, metadata, status, scheduled_at')
      .single()

    if (createMatchError || !createdMatch) throw error(500, 'Failed to create match')
    match = createdMatch
  }

  const importMatchesTeamA = match.team_a_id === importedTeamA.id

  const normalizedSeriesMaps = normalizedMaps.map((map: any, mapIndex: number) => {
    const rawTeamARounds = parseInteger(map.teamARounds, `Map ${mapIndex + 1} Team A rounds`)
    const rawTeamBRounds = parseInteger(map.teamBRounds, `Map ${mapIndex + 1} Team B rounds`)
    const normalizedRows = (map.playerRows as any[]).map((row: any, index: number) => ({
      player_name: normalizeOptional(row.player_name) ?? `Player ${index + 1}`,
      agents: normalizeOptional(row.agents),
      side: row.side === 'b' ? 'b' : 'a',
      profile_id:
        normalizeOptional(row.profile_id) ??
        profileMatcher.resolve(normalizeOptional(row.player_name) ?? ''),
      acs: Number(row.acs ?? 0),
      kills: parseInteger(row.kills ?? 0, 'Kills'),
      deaths: parseInteger(row.deaths ?? 0, 'Deaths'),
      assists: parseInteger(row.assists ?? 0, 'Assists'),
      kd: Number(row.kd ?? 0),
      adr: Number(row.adr ?? 0),
      kast_pct: Number(row.kast_pct ?? 0),
      fk: parseInteger(row.fk ?? 0, 'FK'),
      fd: parseInteger(row.fd ?? 0, 'FD'),
      hs_pct: Number(row.hs_pct ?? 0),
      plants: parseInteger(row.plants ?? 0, 'Plants'),
      defuses: parseInteger(row.defuses ?? 0, 'Defuses'),
      econ_rating: Number(row.econ_rating ?? 0),
      games: 1,
      games_won:
        row.side === 'a'
          ? rawTeamARounds > rawTeamBRounds
            ? 1
            : 0
          : rawTeamBRounds > rawTeamARounds
            ? 1
            : 0,
      games_lost:
        row.side === 'a'
          ? rawTeamARounds < rawTeamBRounds
            ? 1
            : 0
          : rawTeamBRounds < rawTeamARounds
            ? 1
            : 0,
      rounds: rawTeamARounds + rawTeamBRounds,
      rounds_won: row.side === 'a' ? rawTeamARounds : rawTeamBRounds,
      rounds_lost: row.side === 'a' ? rawTeamBRounds : rawTeamARounds,
      kpg: parseInteger(row.kills ?? 0, 'Kills'),
      kpr:
        rawTeamARounds + rawTeamBRounds > 0
          ? Number(row.kills ?? 0) / (rawTeamARounds + rawTeamBRounds)
          : 0,
      dpg: parseInteger(row.deaths ?? 0, 'Deaths'),
      dpr:
        rawTeamARounds + rawTeamBRounds > 0
          ? Number(row.deaths ?? 0) / (rawTeamARounds + rawTeamBRounds)
          : 0,
      apg: parseInteger(row.assists ?? 0, 'Assists'),
      apr:
        rawTeamARounds + rawTeamBRounds > 0
          ? Number(row.assists ?? 0) / (rawTeamARounds + rawTeamBRounds)
          : 0,
      fkpg: parseInteger(row.fk ?? 0, 'FK'),
      fdpg: parseInteger(row.fd ?? 0, 'FD'),
      plants_per_game: parseInteger(row.plants ?? 0, 'Plants'),
      defuses_per_game: parseInteger(row.defuses ?? 0, 'Defuses'),
    }))

    return {
      sourceFilename: normalizeOptional(map.sourceFilename) ?? `map-${mapIndex + 1}.csv`,
      mapName: normalizeOptional(map.mapName),
      rawTeamARounds,
      rawTeamBRounds,
      mapTeamARounds: importMatchesTeamA ? rawTeamARounds : rawTeamBRounds,
      mapTeamBRounds: importMatchesTeamA ? rawTeamBRounds : rawTeamARounds,
      normalizedRows,
    }
  })

  const unresolvedPlayers = Array.from(
    new Set(
      normalizedSeriesMaps.flatMap((map) =>
        map.normalizedRows.filter((row: any) => !row.profile_id).map((row: any) => row.player_name)
      )
    )
  )

  const seriesTeamAScore = normalizedSeriesMaps.reduce(
    (total, map) => total + (map.mapTeamARounds > map.mapTeamBRounds ? 1 : 0),
    0
  )
  const seriesTeamBScore = normalizedSeriesMaps.reduce(
    (total, map) => total + (map.mapTeamBRounds > map.mapTeamARounds ? 1 : 0),
    0
  )
  const winnerTeamId =
    seriesTeamAScore === seriesTeamBScore
      ? null
      : seriesTeamAScore > seriesTeamBScore
        ? match.team_a_id
        : match.team_b_id

  const batchId = crypto.randomUUID()
  const importedAt = new Date().toISOString()
  const { error: batchError } = await supabaseAdmin.from('stat_import_batches').insert({
    id: batchId,
    uploaded_by_profile_id: admin.id,
    source_filename: primarySourceFilename,
    display_name: displayName,
    import_kind: 'aggregate',
    status: 'applied',
    dry_run: false,
    row_count: normalizedSeriesMaps.reduce((total, map) => total + map.normalizedRows.length, 0),
    accepted_count: normalizedSeriesMaps.reduce(
      (total, map) => total + map.normalizedRows.length,
      0
    ),
    rejected_count: unresolvedPlayers.length,
    approved_by_profile_id: admin.id,
    approved_at: importedAt,
    metadata: {
      import_type: 'match_csv',
      match_id: match.id,
      map_count: normalizedSeriesMaps.length,
      unresolved_players: unresolvedPlayers,
    },
  })

  if (batchError) throw error(500, 'Failed to create import batch')

  const { data: existingMaps, error: existingMapsError } = await supabaseAdmin
    .from('match_maps')
    .select('id, map_order, source_filename, map_name')
    .eq('match_id', match.id)
    .order('map_order', { ascending: true })

  if (existingMapsError) throw error(500, 'Failed to load existing maps')

  if ((existingMaps ?? []).length > 0) {
    const existingMapIds = (existingMaps ?? []).map((entry) => entry.id)

    const { error: deleteMapStatsError } = await supabaseAdmin
      .from('player_match_map_stats')
      .delete()
      .in('match_map_id', existingMapIds)

    if (deleteMapStatsError) throw error(500, 'Failed to clear existing map stats for re-import')

    const { error: deleteMapsError } = await supabaseAdmin
      .from('match_maps')
      .delete()
      .eq('match_id', match.id)

    if (deleteMapsError) throw error(500, 'Failed to clear existing maps for re-import')
  }

  const insertedMapIds: string[] = []

  for (const [mapIndex, map] of normalizedSeriesMaps.entries()) {
    const { data: createdMap, error: createMapError } = await supabaseAdmin
      .from('match_maps')
      .insert({
        match_id: match.id,
        map_order: mapIndex + 1,
        map_name: map.mapName,
        team_a_rounds: map.mapTeamARounds,
        team_b_rounds: map.mapTeamBRounds,
        imported_by_profile_id: admin.id,
        source_filename: map.sourceFilename,
        metadata: {
          import_batch_id: batchId,
          imported_at: importedAt,
        },
      })
      .select('id')
      .single()

    if (createMapError || !createdMap) throw error(500, `Failed to create map ${mapIndex + 1}`)
    const matchMapId = createdMap.id

    insertedMapIds.push(matchMapId)

    const rowsToInsert = map.normalizedRows.map((row: any) => {
      const isImportTeamA = row.side === 'a'
      const teamId = isImportTeamA === importMatchesTeamA ? match.team_a_id : match.team_b_id

      return {
        match_map_id: matchMapId,
        match_id: match.id,
        profile_id: row.profile_id,
        team_id: teamId,
        player_name: row.player_name,
        agents: row.agents,
        games: row.games,
        games_won: row.games_won,
        games_lost: row.games_lost,
        rounds: row.rounds,
        rounds_won: row.rounds_won,
        rounds_lost: row.rounds_lost,
        acs: row.acs,
        kd: row.kd,
        kast_pct: row.kast_pct,
        adr: row.adr,
        kills: row.kills,
        deaths: row.deaths,
        assists: row.assists,
        fk: row.fk,
        fd: row.fd,
        hs_pct: row.hs_pct,
        econ_rating: row.econ_rating,
        kpg: row.kpg,
        kpr: row.kpr,
        dpg: row.dpg,
        dpr: row.dpr,
        apg: row.apg,
        apr: row.apr,
        fkpg: row.fkpg,
        fdpg: row.fdpg,
        plants: row.plants,
        plants_per_game: row.plants_per_game,
        defuses: row.defuses,
        defuses_per_game: row.defuses_per_game,
        metadata: {
          import_batch_id: batchId,
          import_side: row.side,
          source_filename: map.sourceFilename,
        },
      }
    })

    const { error: insertStatsError } = await supabaseAdmin
      .from('player_match_map_stats')
      .insert(rowsToInsert)
    if (insertStatsError)
      throw error(500, `Failed to insert player map stats for map ${mapIndex + 1}`)
  }

  await rebuildPlayerMatchStats(match.id)

  const { error: updateMatchError } = await supabaseAdmin
    .from('matches')
    .update({
      best_of: bestOf,
      status: 'completed',
      ended_at: new Date().toISOString(),
      team_a_score: seriesTeamAScore,
      team_b_score: seriesTeamBScore,
      winner_team_id: winnerTeamId,
      metadata: {
        ...(match.metadata ?? {}),
        imported_from_csv: true,
        has_series_result: true,
        latest_map_import_batch_id: batchId,
        imported_map_count: insertedMapIds.length,
      },
    })
    .eq('id', match.id)

  if (updateMatchError) throw error(500, 'Failed to update imported match result')

  return json({
    success: true,
    matchId: match.id,
    mapIds: insertedMapIds,
    teamAScore: seriesTeamAScore,
    teamBScore: seriesTeamBScore,
    unresolvedPlayers,
  })
}
