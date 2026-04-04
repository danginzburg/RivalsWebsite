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

export const POST: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const teamAName = normalizeOptional(body.teamAName)
  const teamBName = normalizeOptional(body.teamBName)
  const mapName = normalizeOptional(body.mapName)
  const sourceFilename = normalizeOptional(body.sourceFilename) ?? 'match.csv'
  const displayName = normalizeOptional(body.displayName) ?? sourceFilename
  const scheduledAt = parseMatchCsvDate(normalizeOptional(body.scheduledAt) ?? '')
  const bestOf = [1, 3, 5, 7].includes(Number(body.bestOf)) ? Number(body.bestOf) : 3
  const playerRows = Array.isArray(body.playerRows) ? body.playerRows : []

  if (!teamAName || !teamBName) throw error(400, 'Both team names are required')
  if (teamAName === teamBName) throw error(400, 'Teams must be different')
  if (playerRows.length === 0) throw error(400, 'No player rows provided')

  const teamARounds = parseInteger(body.teamARounds, 'Team A rounds')
  const teamBRounds = parseInteger(body.teamBRounds, 'Team B rounds')

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

  const normalizedRows = playerRows.map((row: any, index: number) => ({
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
      row.side === 'a' ? (teamARounds > teamBRounds ? 1 : 0) : teamBRounds > teamARounds ? 1 : 0,
    games_lost:
      row.side === 'a' ? (teamARounds < teamBRounds ? 1 : 0) : teamBRounds < teamARounds ? 1 : 0,
    rounds: teamARounds + teamBRounds,
    rounds_won: row.side === 'a' ? teamARounds : teamBRounds,
    rounds_lost: row.side === 'a' ? teamBRounds : teamARounds,
    kpg: parseInteger(row.kills ?? 0, 'Kills'),
    kpr: teamARounds + teamBRounds > 0 ? Number(row.kills ?? 0) / (teamARounds + teamBRounds) : 0,
    dpg: parseInteger(row.deaths ?? 0, 'Deaths'),
    dpr: teamARounds + teamBRounds > 0 ? Number(row.deaths ?? 0) / (teamARounds + teamBRounds) : 0,
    apg: parseInteger(row.assists ?? 0, 'Assists'),
    apr: teamARounds + teamBRounds > 0 ? Number(row.assists ?? 0) / (teamARounds + teamBRounds) : 0,
    fkpg: parseInteger(row.fk ?? 0, 'FK'),
    fdpg: parseInteger(row.fd ?? 0, 'FD'),
    plants_per_game: parseInteger(row.plants ?? 0, 'Plants'),
    defuses_per_game: parseInteger(row.defuses ?? 0, 'Defuses'),
  }))

  const unresolvedPlayers = normalizedRows
    .filter((row: any) => !row.profile_id)
    .map((row: any) => row.player_name)

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
          has_series_result: false,
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
  const mapTeamARounds = importMatchesTeamA ? teamARounds : teamBRounds
  const mapTeamBRounds = importMatchesTeamA ? teamBRounds : teamARounds

  const batchId = crypto.randomUUID()
  const importedAt = new Date().toISOString()
  const { error: batchError } = await supabaseAdmin.from('stat_import_batches').insert({
    id: batchId,
    uploaded_by_profile_id: admin.id,
    source_filename: sourceFilename,
    display_name: displayName,
    import_kind: 'aggregate',
    status: 'applied',
    dry_run: false,
    row_count: normalizedRows.length,
    accepted_count: normalizedRows.length,
    rejected_count: unresolvedPlayers.length,
    approved_by_profile_id: admin.id,
    approved_at: importedAt,
    metadata: {
      import_type: 'match_csv',
      match_id: match.id,
      map_name: mapName,
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

  let existingMap =
    (existingMaps ?? []).find((entry) => entry.source_filename === sourceFilename) ?? null
  if (!existingMap && mapName) {
    const sameName = (existingMaps ?? []).filter((entry) => entry.map_name === mapName)
    if (sameName.length === 1) existingMap = sameName[0]
  }

  const nextOrder =
    (existingMaps ?? []).reduce((max, entry) => Math.max(max, entry.map_order ?? 0), 0) + 1
  let matchMapId = existingMap?.id ?? null

  if (existingMap) {
    const { error: updateMapError } = await supabaseAdmin
      .from('match_maps')
      .update({
        map_name: mapName,
        team_a_rounds: mapTeamARounds,
        team_b_rounds: mapTeamBRounds,
        imported_by_profile_id: admin.id,
        source_filename: sourceFilename,
        metadata: {
          import_batch_id: batchId,
          imported_at: importedAt,
        },
      })
      .eq('id', existingMap.id)

    if (updateMapError) throw error(500, 'Failed to update map row')
    await supabaseAdmin.from('player_match_map_stats').delete().eq('match_map_id', existingMap.id)
    matchMapId = existingMap.id
  } else {
    const { data: createdMap, error: createMapError } = await supabaseAdmin
      .from('match_maps')
      .insert({
        match_id: match.id,
        map_order: nextOrder,
        map_name: mapName,
        team_a_rounds: mapTeamARounds,
        team_b_rounds: mapTeamBRounds,
        imported_by_profile_id: admin.id,
        source_filename: sourceFilename,
        metadata: {
          import_batch_id: batchId,
          imported_at: importedAt,
        },
      })
      .select('id')
      .single()

    if (createMapError || !createdMap) throw error(500, 'Failed to create match map row')
    matchMapId = createdMap.id
  }

  const rowsToInsert = normalizedRows.map((row: any) => {
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
      },
    }
  })

  const { error: insertStatsError } = await supabaseAdmin
    .from('player_match_map_stats')
    .insert(rowsToInsert)
  if (insertStatsError) throw error(500, 'Failed to insert imported player map stats')

  await rebuildPlayerMatchStats(match.id)

  const mapCount = existingMap ? nextOrder - 1 : nextOrder
  await supabaseAdmin
    .from('matches')
    .update({
      metadata: {
        ...(match.metadata ?? {}),
        imported_from_csv: true,
        has_series_result: false,
        latest_map_import_batch_id: batchId,
        imported_map_count: mapCount,
      },
    })
    .eq('id', match.id)

  return json({
    success: true,
    matchId: match.id,
    mapId: matchMapId,
    unresolvedPlayers,
  })
}
