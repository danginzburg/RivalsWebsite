import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import {
  type AdminAwardResolution,
  parseMapNotes,
  parseOptionalUuid,
  resolveAdminAwardForfeit,
  winnerFromMapSeriesScore,
} from '$lib/server/imports/matchImportForfeit'
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

function normalizeTeamKey(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function flipSide(side: 'a' | 'b') {
  return side === 'a' ? 'b' : 'a'
}

function stripForfeitFromMetadata(meta: Record<string, unknown> | null | undefined) {
  if (!meta || typeof meta !== 'object') return {}
  const rest = { ...(meta as Record<string, unknown>) }
  delete rest.forfeit
  return rest
}

export const POST: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

  const importKind = normalizeOptional(body.importKind) ?? 'series_csv'

  if (importKind === 'forfeit_no_show') {
    return handleForfeitNoShow(body, admin.id)
  }

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

  const canonicalTeams = [normalizeTeamKey(teamAName), normalizeTeamKey(teamBName)].sort()

  for (const [index, map] of normalizedMaps.entries()) {
    const mapTeams = [
      normalizeTeamKey(normalizeOptional(map.teamAName)),
      normalizeTeamKey(normalizeOptional(map.teamBName)),
    ].sort()
    if (mapTeams[0] !== canonicalTeams[0] || mapTeams[1] !== canonicalTeams[1]) {
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

  const preliminarySeriesMaps = normalizedMaps.map((map: any, mapIndex: number) => {
    const mapTeamAName = normalizeOptional(map.teamAName)
    const mapTeamBName = normalizeOptional(map.teamBName)
    const isCanonicalOrder =
      normalizeTeamKey(mapTeamAName) === normalizeTeamKey(teamAName) &&
      normalizeTeamKey(mapTeamBName) === normalizeTeamKey(teamBName)
    const isFlippedOrder =
      normalizeTeamKey(mapTeamAName) === normalizeTeamKey(teamBName) &&
      normalizeTeamKey(mapTeamBName) === normalizeTeamKey(teamAName)

    if (!isCanonicalOrder && !isFlippedOrder) {
      throw error(400, `Map ${mapIndex + 1} teams do not match the series matchup`)
    }

    const rawTeamARounds = parseInteger(map.teamARounds, `Map ${mapIndex + 1} Team A rounds`)
    const rawTeamBRounds = parseInteger(map.teamBRounds, `Map ${mapIndex + 1} Team B rounds`)
    const rawRows = (map.playerRows as any[]).map((row: any, index: number) => ({
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
    }))

    return {
      sourceFilename: normalizeOptional(map.sourceFilename) ?? `map-${mapIndex + 1}.csv`,
      mapName: normalizeOptional(map.mapName),
      rawTeamARounds,
      rawTeamBRounds,
      isFlippedOrder,
      footerTeamAId: isFlippedOrder ? importedTeamB.id : importedTeamA.id,
      footerTeamBId: isFlippedOrder ? importedTeamA.id : importedTeamB.id,
      rawRows,
    }
  })

  const resolvedProfileIds = Array.from(
    new Set(
      preliminarySeriesMaps.flatMap((map) =>
        map.rawRows.map((row: any) => row.profile_id).filter(Boolean)
      )
    )
  ) as string[]

  let importedTeamByProfileId = new Map<string, string>()
  if (resolvedProfileIds.length > 0) {
    const { data: memberships, error: membershipsError } = await supabaseAdmin
      .from('team_memberships')
      .select('profile_id, team_id')
      .in('profile_id', resolvedProfileIds)
      .in('team_id', [importedTeamA.id, importedTeamB.id])
      .eq('is_active', true)
      .is('left_at', null)

    if (membershipsError) throw error(500, 'Failed to resolve imported player teams')

    importedTeamByProfileId = new Map(
      (memberships ?? []).map((membership) => [membership.profile_id, membership.team_id])
    )
  }

  const normalizedSeriesMaps = preliminarySeriesMaps.map((map) => {
    const directMatches = map.rawRows.reduce((total: number, row: any) => {
      const teamId = row.profile_id ? (importedTeamByProfileId.get(row.profile_id) ?? null) : null
      if (!teamId) return total
      return (
        total +
        Number(
          (row.side === 'a' && teamId === map.footerTeamAId) ||
            (row.side === 'b' && teamId === map.footerTeamBId)
        )
      )
    }, 0)

    const swappedMatches = map.rawRows.reduce((total: number, row: any) => {
      const teamId = row.profile_id ? (importedTeamByProfileId.get(row.profile_id) ?? null) : null
      if (!teamId) return total
      return (
        total +
        Number(
          (row.side === 'a' && teamId === map.footerTeamBId) ||
            (row.side === 'b' && teamId === map.footerTeamAId)
        )
      )
    }, 0)

    const footerAlignedRows =
      swappedMatches > directMatches
        ? map.rawRows.map((row: any) => ({ ...row, side: flipSide(row.side) }))
        : map.rawRows

    const canonicalTeamARounds = map.isFlippedOrder ? map.rawTeamBRounds : map.rawTeamARounds
    const canonicalTeamBRounds = map.isFlippedOrder ? map.rawTeamARounds : map.rawTeamBRounds
    const totalRounds = canonicalTeamARounds + canonicalTeamBRounds

    const normalizedRows = footerAlignedRows.map((row: any) => {
      const side = map.isFlippedOrder ? flipSide(row.side) : row.side
      const roundsWon = side === 'a' ? canonicalTeamARounds : canonicalTeamBRounds
      const roundsLost = side === 'a' ? canonicalTeamBRounds : canonicalTeamARounds

      return {
        ...row,
        side,
        games: 1,
        games_won: roundsWon > roundsLost ? 1 : 0,
        games_lost: roundsWon < roundsLost ? 1 : 0,
        rounds: totalRounds,
        rounds_won: roundsWon,
        rounds_lost: roundsLost,
        kpg: row.kills,
        kpr: totalRounds > 0 ? row.kills / totalRounds : 0,
        dpg: row.deaths,
        dpr: totalRounds > 0 ? row.deaths / totalRounds : 0,
        apg: row.assists,
        apr: totalRounds > 0 ? row.assists / totalRounds : 0,
        fkpg: row.fk,
        fdpg: row.fd,
        plants_per_game: row.plants,
        defuses_per_game: row.defuses,
      }
    })

    return {
      sourceFilename: map.sourceFilename,
      mapName: map.mapName,
      rawTeamARounds: map.rawTeamARounds,
      rawTeamBRounds: map.rawTeamBRounds,
      mapTeamARounds: importMatchesTeamA ? canonicalTeamARounds : canonicalTeamBRounds,
      mapTeamBRounds: importMatchesTeamA ? canonicalTeamBRounds : canonicalTeamARounds,
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

  const mapWinnerTeamId = winnerFromMapSeriesScore(
    seriesTeamAScore,
    seriesTeamBScore,
    match.team_a_id,
    match.team_b_id
  )

  const officialWinnerTeamId = parseOptionalUuid(body.officialWinnerTeamId)
  const forfeitingTeamIdOpt = parseOptionalUuid(body.forfeitingTeamId)
  const forfeitingReason = normalizeOptional(body.forfeitReason)
  const mapNotes = parseMapNotes(body.mapNotes)

  let winnerTeamId: string | null
  let adminMatchForfeit: AdminAwardResolution['matchForfeit'] = null
  let perMapForfeitMeta: AdminAwardResolution['perMapForfeitMeta'] = new Map()

  try {
    const resolved = resolveAdminAwardForfeit({
      mapWinnerTeamId,
      officialWinnerTeamId,
      forfeitingTeamId: forfeitingTeamIdOpt,
      teamAId: match.team_a_id,
      teamBId: match.team_b_id,
      reason: forfeitingReason,
      mapNotes,
      mapCount: normalizedSeriesMaps.length,
    })
    winnerTeamId = resolved.winnerTeamId
    adminMatchForfeit = resolved.matchForfeit
    perMapForfeitMeta = resolved.perMapForfeitMeta
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'Invalid forfeit override')
  }

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
    const mapOrder = mapIndex + 1
    const forfeitSlice = perMapForfeitMeta.get(mapOrder)
    const { data: createdMap, error: createMapError } = await supabaseAdmin
      .from('match_maps')
      .insert({
        match_id: match.id,
        map_order: mapOrder,
        map_name: map.mapName,
        team_a_rounds: map.mapTeamARounds,
        team_b_rounds: map.mapTeamBRounds,
        imported_by_profile_id: admin.id,
        source_filename: map.sourceFilename,
        metadata: {
          import_batch_id: batchId,
          imported_at: importedAt,
          ...(forfeitSlice ? { forfeit: forfeitSlice } : {}),
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

  const metaBase = stripForfeitFromMetadata(match.metadata as Record<string, unknown> | null)

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
        ...metaBase,
        imported_from_csv: true,
        has_series_result: true,
        latest_map_import_batch_id: batchId,
        imported_map_count: insertedMapIds.length,
        ...(adminMatchForfeit ? { forfeit: adminMatchForfeit } : {}),
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

async function handleForfeitNoShow(body: Record<string, unknown>, adminProfileId: string) {
  const teamAName = normalizeOptional(body.teamAName)
  const teamBName = normalizeOptional(body.teamBName)
  const scheduledAtRaw = normalizeOptional(body.scheduledAt)
  const displayName = normalizeOptional(body.displayName) ?? 'forfeit-no-show'

  if (!teamAName || !teamBName) throw error(400, 'Both team names are required')
  if (!scheduledAtRaw) throw error(400, 'scheduledAt is required')
  if (teamAName === teamBName) throw error(400, 'Teams must be different')

  const scheduledAt = parseMatchCsvDate(scheduledAtRaw)
  const winnerTeamId = parseOptionalUuid(body.winnerTeamId)
  if (!winnerTeamId) throw error(400, 'winnerTeamId must be a valid UUID')

  const teamAScore = Number(body.teamAScore ?? 2)
  const teamBScore = Number(body.teamBScore ?? 0)
  if (!Number.isInteger(teamAScore) || teamAScore < 0)
    throw error(400, 'teamAScore must be a non-negative integer')
  if (!Number.isInteger(teamBScore) || teamBScore < 0)
    throw error(400, 'teamBScore must be a non-negative integer')

  const bestOf = [1, 3, 5, 7].includes(Number(body.bestOf)) ? Number(body.bestOf) : 3

  const [teams] = await Promise.all([getApprovedTeamsForImports()])
  const teamMatcher = buildTeamMatcher(teams)

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

  if (![importedTeamA.id, importedTeamB.id].includes(winnerTeamId)) {
    throw error(400, 'winnerTeamId must be one of the two resolved teams')
  }

  const winnerAhead =
    winnerTeamId === importedTeamA.id ? teamAScore > teamBScore : teamBScore > teamAScore
  if (!winnerAhead) {
    throw error(400, 'Scores must favor the winning team')
  }

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
        submitted_by_profile_id: adminProfileId,
        approved_by_profile_id: adminProfileId,
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

  const canonicalAScore = match.team_a_id === importedTeamA.id ? teamAScore : teamBScore
  const canonicalBScore = match.team_b_id === importedTeamB.id ? teamBScore : teamAScore

  const { data: existingMaps, error: existingMapsError } = await supabaseAdmin
    .from('match_maps')
    .select('id')
    .eq('match_id', match.id)

  if (existingMapsError) throw error(500, 'Failed to load existing maps')

  if ((existingMaps ?? []).length > 0) {
    const existingMapIds = (existingMaps ?? []).map((entry) => entry.id)
    await supabaseAdmin.from('player_match_map_stats').delete().in('match_map_id', existingMapIds)
    await supabaseAdmin.from('match_maps').delete().eq('match_id', match.id)
  }

  await rebuildPlayerMatchStats(match.id)

  const metaBase = stripForfeitFromMetadata(match.metadata as Record<string, unknown> | null)
  const forfeitingTeamId = winnerTeamId === match.team_a_id ? match.team_b_id : match.team_a_id

  const { error: updateMatchError } = await supabaseAdmin
    .from('matches')
    .update({
      best_of: bestOf,
      status: 'completed',
      ended_at: new Date().toISOString(),
      team_a_score: canonicalAScore,
      team_b_score: canonicalBScore,
      winner_team_id: winnerTeamId,
      metadata: {
        ...metaBase,
        imported_from_csv: true,
        has_series_result: true,
        import_display_name: displayName,
        forfeit: {
          kind: 'no_show',
          forfeiting_team_id: forfeitingTeamId,
        },
      },
    })
    .eq('id', match.id)

  if (updateMatchError) throw error(500, 'Failed to update forfeit match')

  return json({
    success: true,
    matchId: match.id,
    mapIds: [] as string[],
    teamAScore: canonicalAScore,
    teamBScore: canonicalBScore,
    unresolvedPlayers: [] as string[],
  })
}
