/**
 * A completed series read straight from Riot match ids / tracker.gg links,
 * shared by the admin importer and the captain result submission so the two
 * can never disagree about how a lobby maps onto league teams.
 *
 * `prepareRiotSeries` does every read (Riot fetches, roster resolution, side
 * continuity, forfeit splicing) and writes nothing — it is the dry run.
 * `commitRiotSeries` takes what it produced and writes it through
 * `importCompletedSeries`, exactly as the CSV import does.
 */
import { error } from '@sveltejs/kit'

import { supabaseAdmin } from '$lib/supabase/admin'
import { RiotLookupError } from '$lib/server/riot/henrik'
import {
  fetchMatch,
  roundStartTime,
  toImportMap,
  MATCH_REGIONS,
  type MatchRegion,
  type RiotMatchDetail,
} from '$lib/server/riot/match'
import { parseMatchIdList } from '$lib/server/riot/match-id'
import {
  resolveSeriesTeams,
  resolveSeriesTeamsManual,
  sideForTeamAByContinuity,
} from '$lib/server/riot/match-teams'
import {
  buildProfileMatcher,
  getProfilesForImports,
  getRiotAccountsForImports,
} from '$lib/server/imports/matching'
import { backfillRiotAccountPuuids } from '$lib/server/imports/puuid-backfill'
import { upsertRiotIdentities } from '$lib/server/players/riot-identities'
import { refreshSeasonRanks } from '$lib/server/players/riot-ranks'
import { importCompletedSeries } from '$lib/server/matches/import-lifecycle'
import { resolveTargetSeasonId } from '$lib/server/seasons/resolve'
import { loadRosterTimeline, matchRosterTime } from '$lib/server/matches/subs'

/** A best-of-seven is the longest series the league runs. */
export const MAX_SERIES_MAPS = 7

export function parseRegion(value: unknown): MatchRegion {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : 'na'
  if (!(MATCH_REGIONS as readonly string[]).includes(raw)) {
    throw error(400, `region must be one of ${MATCH_REGIONS.join(', ')}`)
  }
  return raw as MatchRegion
}

export type ForfeitMapSpec = {
  /** 1-based position in the series; the map is inserted at this order. */
  order: number
  /**
   * The team that won the forfeit, by id. The submitter can't know which side
   * the server will call team A until the rosters resolve, so the winner is
   * named as a team and mapped onto a side after resolution.
   */
  winnerTeamId: string
  winnerRounds: number
  loserRounds: number
  label: string | null
}

/**
 * A forfeited map is optional and entirely hand-entered, so an absent value is
 * "no forfeit map". Only the winning team is required; the scoreline defaults
 * to a standard 13-0 concession.
 */
export function parseForfeitMap(value: unknown): ForfeitMapSpec | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const winnerTeamId = typeof raw.winnerTeamId === 'string' ? raw.winnerTeamId.trim() : ''
  if (!winnerTeamId) throw error(400, 'Pick which team won the forfeited map.')

  const order = Number.isInteger(Number(raw.order)) ? Math.max(1, Number(raw.order)) : 1
  const winnerRounds =
    Number.isInteger(Number(raw.winnerRounds)) && Number(raw.winnerRounds) >= 0
      ? Number(raw.winnerRounds)
      : 13
  const loserRounds =
    Number.isInteger(Number(raw.loserRounds)) && Number(raw.loserRounds) >= 0
      ? Number(raw.loserRounds)
      : 0
  if (winnerRounds <= loserRounds) {
    throw error(400, 'The forfeit winner must have more rounds than the loser.')
  }
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : null

  return { order, winnerTeamId, winnerRounds, loserRounds, label }
}

/**
 * The match ids in a pasted list, validated for size. Separate from the fetch
 * so a caller can rate-limit between the two — each id costs a Riot request.
 */
export function parseSeriesInput(input: unknown, forfeitMap: ForfeitMapSpec | null) {
  const { ids, unparsed } = parseMatchIdList(typeof input === 'string' ? input : '')
  if (ids.length === 0) {
    throw error(400, 'No Riot match ids or tracker.gg match links found in that input.')
  }
  const totalMaps = ids.length + (forfeitMap ? 1 : 0)
  if (totalMaps > MAX_SERIES_MAPS) {
    throw error(400, `That is ${totalMaps} maps — a series is at most ${MAX_SERIES_MAPS} maps.`)
  }
  return { ids, unparsed }
}

export type SeriesPreviewMap = {
  matchId: string
  mapName: string | null
  startedAt: string | null
  score: string
  /** Rounds credited to the series' team A / team B on this map. */
  teamARounds: number
  teamBRounds: number
  playerCount: number
  isForfeit: boolean
}

export type SeriesPreview = {
  region: MatchRegion
  teamA: { id: string; name: string; rosterVotes: number }
  teamB: { id: string; name: string; rosterVotes: number }
  unmatchedPlayers: string[]
  unparsedInput: string[]
  maps: SeriesPreviewMap[]
}

/**
 * How the automatic roster vote — no teams supplied — read one map. A captain
 * submission only applies itself when every map's vote lands on the match's
 * own two teams; this is that evidence, gathered during the same pass.
 */
export type AutoTeamCheck =
  | { ok: true; teamIds: [string, string] }
  | { ok: false; reason: string; unmatched: string[] }

type SeriesMap = ReturnType<typeof toImportMap> & { isForfeit?: boolean; forfeitLabel?: string }

export type PreparedSeries = {
  ids: string[]
  matches: RiotMatchDetail[]
  seasonId: string | null
  teamAId: string
  teamBId: string
  seriesMaps: SeriesMap[]
  preview: SeriesPreview
  autoTeamChecks: AutoTeamCheck[]
  profileMatcher: ReturnType<typeof buildProfileMatcher>
}

export type PrepareResult =
  | { ok: true; series: PreparedSeries }
  | { ok: false; needsManualTeams: true; reason: string; unmatchedPlayers: string[] }

type TargetMatch = {
  id: string
  team_a_id: string
  team_b_id: string
  season_id: string | null
}

/**
 * Fetch and shape a series without writing anything.
 *
 * Teams come from, in order: the target match, hand-picked ids, or the
 * automatic roster vote. When the vote can't decide and nothing was supplied,
 * the result says so (`needsManualTeams`) rather than throwing, so the admin
 * UI can offer the team picker.
 */
export async function prepareRiotSeries(opts: {
  ids: string[]
  unparsed: string[]
  region: MatchRegion
  targetMatch: TargetMatch | null
  manualTeamAId?: string
  manualTeamBId?: string
  seasonId?: unknown
  forfeitMap: ForfeitMapSpec | null
}): Promise<PrepareResult> {
  const { ids, unparsed, region, targetMatch, forfeitMap } = opts

  const manualTeamAId = targetMatch ? targetMatch.team_a_id : (opts.manualTeamAId ?? '').trim()
  const manualTeamBId = targetMatch ? targetMatch.team_b_id : (opts.manualTeamBId ?? '').trim()
  const hasManualTeams = manualTeamAId.length > 0 && manualTeamBId.length > 0
  if (hasManualTeams && manualTeamAId === manualTeamBId) {
    throw error(400, 'Pick two different teams.')
  }

  let matches: RiotMatchDetail[]
  try {
    // Sequential rather than parallel: HenrikDev allows 30 requests a minute and
    // a burst of seven buys nothing when the submitter is waiting on all of them.
    matches = []
    for (const id of ids) matches.push(await fetchMatch(id, region))
  } catch (err) {
    if (err instanceof RiotLookupError) throw error(err.status, err.message)
    throw err
  }

  if (matches.some((m) => !m.isCompleted)) {
    throw error(400, 'That match is still in progress, so its stats are not final yet.')
  }

  // Resolve the league teams from the first map's players, then hold that
  // mapping for the whole series — the sides swap between maps, so re-deriving
  // per map would flip team A and team B halfway through.
  const [profiles, riotAccounts] = await Promise.all([
    getProfilesForImports(),
    getRiotAccountsForImports(),
  ])
  const profileMatcher = buildProfileMatcher(profiles, riotAccounts)

  // Only the import season's teams count (the active one unless backfilling a
  // past season). A membership stays `is_active` after a season ends, so a
  // returning player carries live memberships on several teams across seasons;
  // without this scope the profile→team map can resolve a player onto a team
  // they were on a season ago, mis-identifying the match.
  const seasonId = targetMatch?.season_id ?? (await resolveTargetSeasonId(opts.seasonId))

  const { data: seasonTeams } = await supabaseAdmin
    .from('teams')
    .select('id')
    .eq('season_id', seasonId ?? '')
  const seasonTeamIds = (seasonTeams ?? []).map((t) => String(t.id))

  // Rosters as they stood when the game was played, not today: a player who
  // has since moved teams must still resolve onto the team they played for.
  const rosters =
    seasonTeamIds.length > 0
      ? (await loadRosterTimeline(seasonId, seasonTeamIds)).at(
          matchRosterTime({ scheduled_at: matches[0]?.startedAt ?? null })
        )
      : new Map()

  const teamByProfileId = new Map<string, string>()
  for (const [teamId, roster] of rosters) {
    for (const profileId of roster.profileIds) teamByProfileId.set(profileId, teamId)
  }

  const resolveTeamId = (riotId: string, puuid?: string | null) => {
    const profileId = profileMatcher.resolve(riotId, puuid)
    return profileId ? (teamByProfileId.get(profileId) ?? null) : null
  }

  const first = matches[0]
  const toSidePlayers = (match: RiotMatchDetail) =>
    match.players.map((p) => ({ riotId: p.riotId, team: p.team, puuid: p.puuid }))

  const resolveSeries = (match: RiotMatchDetail) =>
    hasManualTeams
      ? resolveSeriesTeamsManual(toSidePlayers(match), resolveTeamId, manualTeamAId, manualTeamBId)
      : resolveSeriesTeams(toSidePlayers(match), resolveTeamId)

  // The automatic vote per map, independent of any supplied teams.
  const autoTeamChecks: AutoTeamCheck[] = matches.map((match) => {
    const auto = resolveSeriesTeams(toSidePlayers(match), resolveTeamId)
    return auto.ok
      ? { ok: true, teamIds: [auto.resolution.teamAId, auto.resolution.teamBId] }
      : { ok: false, reason: auto.failure.reason, unmatched: auto.failure.unmatched }
  })

  const resolved = resolveSeries(first)

  if (!resolved.ok) {
    const suffix =
      resolved.failure.unmatched.length > 0
        ? ` Unrecognised players: ${resolved.failure.unmatched.join(', ')}.`
        : ''

    // With teams already supplied there is nothing left to fall back to.
    if (hasManualTeams) throw error(422, `${resolved.failure.reason}${suffix}`)

    return {
      ok: false,
      needsManualTeams: true,
      reason: `${resolved.failure.reason}${suffix}`,
      unmatchedPlayers: resolved.failure.unmatched,
    }
  }

  const { teamAId, teamBId, teamAValorantSide, teamAVotes, teamBVotes, unmatched } =
    resolved.resolution

  const { data: teamRows } = await supabaseAdmin
    .from('teams')
    .select('id, name')
    .in('id', [teamAId, teamBId])

  const nameById = new Map((teamRows ?? []).map((t) => [t.id, String(t.name)]))
  const teamAName = nameById.get(teamAId)
  const teamBName = nameById.get(teamBId)
  if (!teamAName || !teamBName) throw error(422, 'Resolved a team that no longer exists.')

  /**
   * Sides swap between maps, so team A's colour on map 2 is not its colour on
   * map 1. The reliable signal is the roster itself: the same players carry
   * across the series, so we anchor team A's side on map 1 and follow those
   * players to whichever side they are on for each later map. This holds even
   * when nobody in the lobby is on a known league roster — the case where the
   * per-map vote has nothing to decide and, left to itself, would pin team A to
   * the Riot player-array order and flip a map (turning a 2-0 into a 1-1).
   *
   * Per-map vote resolution is kept only as a fallback for the rare map whose
   * roster does not carry over at all, and the series anchor as the last resort.
   */
  const anchorTeamAPuuids = new Set(
    first.players
      .filter((p) => p.team === teamAValorantSide)
      .map((p) => p.puuid)
      .filter((puuid): puuid is string => Boolean(puuid))
  )

  const maps = matches.map((match, index) => {
    const perMap = resolveSeries(match)
    const perMapSide = perMap.ok
      ? perMap.resolution.teamAId === teamAId
        ? perMap.resolution.teamAValorantSide
        : (match.teams.find((t) => t.id !== perMap.resolution.teamAValorantSide)?.id ?? null)
      : null

    const sideForTeamA =
      sideForTeamAByContinuity(anchorTeamAPuuids, match.players) ?? perMapSide ?? teamAValorantSide

    return toImportMap(match, {
      teamAValorantSide: sideForTeamA,
      teamAName,
      teamBName,
      mapOrder: index + 1,
    })
  })

  // Splice the hand-entered forfeit map into the fetched series. It carries no
  // players and no game id; its position in the array is its map order, and the
  // winning team is mapped onto whichever side (A/B) it resolved to.
  const seriesMaps: SeriesMap[] = [...maps]
  const previewMaps: Array<Omit<SeriesPreviewMap, 'matchId'> & { matchId: string | null }> =
    maps.map((map, index) => ({
      matchId: matches[index].matchId as string | null,
      mapName: map.mapName as string | null,
      startedAt: map.scheduledAt,
      score: `${map.teamARounds}-${map.teamBRounds}`,
      teamARounds: Number(map.teamARounds),
      teamBRounds: Number(map.teamBRounds),
      playerCount: map.playerRows.length,
      isForfeit: false,
    }))

  if (forfeitMap) {
    if (forfeitMap.winnerTeamId !== teamAId && forfeitMap.winnerTeamId !== teamBId) {
      throw error(
        400,
        `The forfeit winner must be one of the two teams in this series (${teamAName} or ${teamBName}).`
      )
    }
    const winnerIsA = forfeitMap.winnerTeamId === teamAId
    const forfeitTeamARounds = winnerIsA ? forfeitMap.winnerRounds : forfeitMap.loserRounds
    const forfeitTeamBRounds = winnerIsA ? forfeitMap.loserRounds : forfeitMap.winnerRounds
    const insertAt = Math.min(Math.max(forfeitMap.order - 1, 0), seriesMaps.length)

    seriesMaps.splice(insertAt, 0, {
      sourceFilename: 'riot-forfeit-map.json',
      mapName: null,
      scheduledAt: roundStartTime(first.startedAt),
      teamAName,
      teamBName,
      teamARounds: forfeitTeamARounds,
      teamBRounds: forfeitTeamBRounds,
      playerRows: [],
      isForfeit: true,
      ...(forfeitMap.label ? { forfeitLabel: forfeitMap.label } : {}),
    } as SeriesMap)
    previewMaps.splice(insertAt, 0, {
      matchId: null,
      mapName: 'Forfeit',
      startedAt: roundStartTime(first.startedAt),
      score: `${forfeitTeamARounds}-${forfeitTeamBRounds}`,
      teamARounds: forfeitTeamARounds,
      teamBRounds: forfeitTeamBRounds,
      playerCount: 0,
      isForfeit: true,
    })
  }

  const preview: SeriesPreview = {
    region,
    teamA: { id: teamAId, name: teamAName, rosterVotes: teamAVotes },
    teamB: { id: teamBId, name: teamBName, rosterVotes: teamBVotes },
    unmatchedPlayers: unmatched,
    unparsedInput: unparsed,
    maps: previewMaps.map((map, index) => ({ ...map, matchId: map.matchId ?? `forfeit-${index}` })),
  }

  return {
    ok: true,
    series: {
      ids,
      matches,
      seasonId,
      teamAId,
      teamBId,
      seriesMaps,
      preview,
      autoTeamChecks,
      profileMatcher,
    },
  }
}

export type CommitResult = {
  matchId: string | null
  teamAScore: number | null
  teamBScore: number | null
}

/**
 * Write a prepared series. Ranks are refreshed first so the stat batches the
 * import rebuilds pick them up; PUUID backfill and identity recording follow,
 * best-effort, once the match is written.
 */
export async function commitRiotSeries(
  series: PreparedSeries,
  opts: {
    stage: string
    bestOf?: unknown
    targetMatchId?: string | null
    /** Recorded as the importer on the batch and maps. */
    importerProfileId: string
    displayName?: string
  }
): Promise<CommitResult> {
  const { matches, seasonId, profileMatcher } = series
  const first = matches[0]

  // Tournament ranks: each player's highest rank between the season's start
  // and end dates. Bounded so a busy rate limit cannot stall the import.
  let seasonRanks = new Map<string, string>()
  if (seasonId) {
    seasonRanks = await refreshSeasonRanks(
      seasonId,
      matches.flatMap((m) => m.players.map((p) => p.puuid)),
      { deadline: Date.now() + 20_000 }
    ).catch((err) => {
      console.warn('Failed to refresh season ranks for import:', err)
      return new Map<string, string>()
    })
  }

  const response = await importCompletedSeries({
    payload: {
      displayName: opts.displayName ?? `Riot import ${first.matchId}`,
      bestOf: opts.bestOf,
      stage: opts.stage,
      seasonId,
      maps: series.seriesMaps,
      ...(opts.targetMatchId ? { targetMatchId: opts.targetMatchId } : {}),
    },
    adminProfileId: opts.importerProfileId,
  })
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>

  // Self-healing: where a known account matched only by name and has no PUUID
  // stored yet, fill it in so future imports match it by PUUID after a rename.
  const playerPuuidPairs = matches.flatMap((m) =>
    m.players.map((p) => ({ riotId: p.riotId, puuid: p.puuid }))
  )
  await backfillRiotAccountPuuids(playerPuuidPairs, profileMatcher).catch((err) => {
    console.warn('Failed to backfill Riot account PUUIDs after import:', err)
  })

  // Record every PUUID seen, whether or not it maps to a profile yet, so a
  // player can be tracked through a rename before anyone links them. The
  // tournament rank rides along. Best-effort: the match is already written.
  const observations = matches.flatMap((m) =>
    m.players.map((p) => ({
      puuid: p.puuid,
      name: p.name,
      tag: p.tag,
      rank: seasonRanks.get(p.puuid) ?? null,
    }))
  )
  const playedAt = first.startedAt ? new Date(first.startedAt).toISOString() : null
  await upsertRiotIdentities(observations, { playedAt }).catch((err) => {
    console.warn('Failed to record Riot identities after import:', err)
  })

  return {
    matchId: typeof body.matchId === 'string' ? body.matchId : null,
    teamAScore: typeof body.teamAScore === 'number' ? body.teamAScore : null,
    teamBScore: typeof body.teamBScore === 'number' ? body.teamBScore : null,
  }
}
