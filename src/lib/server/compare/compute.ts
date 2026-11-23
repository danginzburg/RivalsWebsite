/**
 * Head-to-head maths for /compare, kept pure so it can be tested without a
 * database. Everything works from one `MatchGraph`: completed matches, their
 * maps, and per-map player rows already resolved to profiles.
 *
 * Teams are compared as the per-season rows they are: a name that returns
 * next season is usually a different roster, so it is a different team here.
 */

export type GraphMatch = {
  id: string
  season_id: string | null
  team_a_id: string
  team_b_id: string
  winner_team_id: string | null
  team_a_score: number
  team_b_score: number
  scheduled_at: string | null
  /** The match's stage (kickoff, regular, playins, playoffs), from its column or its designation. */
  stage: string | null
}

export type GraphMap = {
  id: string
  match_id: string
  map_name: string | null
  team_a_rounds: number | null
  team_b_rounds: number | null
}

export type GraphMapRow = {
  match_map_id: string
  match_id: string
  team_id: string | null
  /** `profile_id`, or the profile the row's Riot name/PUUID resolves to. */
  profile_id: string | null
  rounds: number | null
  acs: number | null
  kills: number | null
  deaths: number | null
  assists: number | null
  adr: number | null
  kast_pct: number | null
  hs_pct: number | null
  fk: number | null
  fd: number | null
}

/** One roster spot: a player on a team, for the stretch they were on it (open ends when unknown). */
export type RosterSpot = {
  team_id: string
  profile_id: string
  joined_at: string | null
  left_at: string | null
}

export type MatchGraph = {
  matches: GraphMatch[]
  /** Voided maps are already left out. */
  maps: GraphMap[]
  rows: GraphMapRow[]
  /**
   * Team rosters, for matches imported without per-map player stats (most of
   * Seasons 2–3): who played is then read from who was on each team.
   */
  rosters: RosterSpot[]
}

export type Record2 = { won: number; lost: number }

/** Which matches a comparison covers: some seasons, optionally one stage. Empty means all. */
export type GraphScope = { seasonIds?: string[] | null; stage?: string | null }

/** The part of the graph inside the scope, so head-to-head follows the chosen stats table. */
export function scopeGraph(graph: MatchGraph, scope: GraphScope): MatchGraph {
  if (!scope.seasonIds && !scope.stage) return graph
  const seasons = scope.seasonIds ? new Set(scope.seasonIds) : null
  const matches = graph.matches.filter(
    (m) =>
      (!seasons || (m.season_id != null && seasons.has(m.season_id))) &&
      (!scope.stage || m.stage === scope.stage)
  )
  const ids = new Set(matches.map((m) => m.id))
  return {
    matches,
    maps: graph.maps.filter((m) => ids.has(m.match_id)),
    rows: graph.rows.filter((r) => ids.has(r.match_id)),
    rosters: graph.rosters,
  }
}

/** Rounds-weighted rates and summed counts over a set of per-map rows. */
export type RowAggregate = {
  maps: number
  rounds: number
  acs: number | null
  kd: number | null
  adr: number | null
  kast_pct: number | null
  hs_pct: number | null
  kills: number
  deaths: number
  assists: number
  fk: number
  fd: number
}

export type MapPoolEntry = { map: string; played: number; won: number }

export type TeamSummary = {
  teamId: string
  series: Record2
  maps: Record2
  roundsWon: number
  roundsLost: number
  /** Combined player stats across the team's recorded maps; null without per-map stats. */
  stats: RowAggregate | null
  mapPool: MapPoolEntry[]
}

export type Meeting = {
  matchId: string
  scheduledAt: string | null
  /** Series score from `a`'s side. */
  scoreA: number
  scoreB: number
  /** The team `a` and `b` played for (always the two compared teams for a team pair). */
  teamA: string | null
  teamB: string | null
}

export type TeamPair = {
  a: string
  b: string
  series: Record2
  maps: Record2
  meetings: Meeting[]
}

export type PlayerPair = {
  a: string
  b: string
  /** Maps where they played on opposite sides, from `a`'s side. */
  against: Record2 & { maps: number }
  /** Series where they met; `won` counts series `a`'s team took. */
  againstSeries: Record2
  /** Each player's stats in the maps they faced each other. */
  statsA: RowAggregate | null
  statsB: RowAggregate | null
  /** Maps where they were on the same team. */
  together: Record2 & { maps: number }
  meetings: Meeting[]
  /**
   * Series counted from team rosters because the match has no per-map stats.
   * Their maps come from the series score, and they add nothing to statsA/statsB.
   */
  fromRosters: number
}

function sum(values: Array<number | null>): number {
  let total = 0
  for (const v of values) if (v != null && Number.isFinite(v)) total += v
  return total
}

function weighted(rows: GraphMapRow[], key: keyof GraphMapRow): number | null {
  let weight = 0
  let total = 0
  for (const row of rows) {
    const value = row[key]
    const w = row.rounds ?? 0
    if (typeof value !== 'number' || !Number.isFinite(value) || w <= 0) continue
    weight += w
    total += value * w
  }
  return weight > 0 ? total / weight : null
}

export function aggregateRows(rows: GraphMapRow[]): RowAggregate | null {
  if (rows.length === 0) return null
  const kills = sum(rows.map((r) => r.kills))
  const deaths = sum(rows.map((r) => r.deaths))
  return {
    maps: new Set(rows.map((r) => r.match_map_id)).size,
    rounds: sum(rows.map((r) => r.rounds)),
    acs: weighted(rows, 'acs'),
    kd: deaths > 0 ? kills / deaths : null,
    adr: weighted(rows, 'adr'),
    kast_pct: weighted(rows, 'kast_pct'),
    hs_pct: weighted(rows, 'hs_pct'),
    kills,
    deaths,
    assists: sum(rows.map((r) => r.assists)),
    fk: sum(rows.map((r) => r.fk)),
    fd: sum(rows.map((r) => r.fd)),
  }
}

/** Did `teamId` win this map? Null when it was not one of the sides or the score is level/missing. */
export function teamWonMap(
  map: GraphMap,
  match: GraphMatch,
  teamId: string | null
): boolean | null {
  if (!teamId) return null
  const isA = teamId === match.team_a_id
  const isB = teamId === match.team_b_id
  if (!isA && !isB) return null
  const a = map.team_a_rounds
  const b = map.team_b_rounds
  if (a == null || b == null || a === b) return null
  return isA ? a > b : b > a
}

function teamRounds(map: GraphMap, match: GraphMatch, teamId: string): [number, number] {
  const a = map.team_a_rounds ?? 0
  const b = map.team_b_rounds ?? 0
  return teamId === match.team_a_id ? [a, b] : [b, a]
}

function seriesScore(match: GraphMatch, teamId: string): [number, number] {
  return teamId === match.team_a_id
    ? [match.team_a_score, match.team_b_score]
    : [match.team_b_score, match.team_a_score]
}

function byDateDesc(a: Meeting, b: Meeting): number {
  return (b.scheduledAt ?? '').localeCompare(a.scheduledAt ?? '')
}

/** Every unordered pair, in input order: (0,1), (0,2) … (1,2) … */
export function pairsOf<T>(items: T[]): Array<[T, T]> {
  const out: Array<[T, T]> = []
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) out.push([items[i]!, items[j]!])
  return out
}

function indexGraph(graph: MatchGraph) {
  const matchById = new Map(graph.matches.map((m) => [m.id, m]))
  const mapById = new Map(graph.maps.map((m) => [m.id, m]))
  const mapsByMatch = new Map<string, GraphMap[]>()
  for (const map of graph.maps) {
    const list = mapsByMatch.get(map.match_id) ?? []
    list.push(map)
    mapsByMatch.set(map.match_id, list)
  }
  return { matchById, mapById, mapsByMatch }
}

export function compareTeams(
  teamIds: string[],
  graph: MatchGraph
): { summaries: TeamSummary[]; pairs: TeamPair[] } {
  const { mapsByMatch, mapById, matchById } = indexGraph(graph)

  const summaries = teamIds.map((teamId): TeamSummary => {
    const series: Record2 = { won: 0, lost: 0 }
    const maps: Record2 = { won: 0, lost: 0 }
    let roundsWon = 0
    let roundsLost = 0
    const pool = new Map<string, MapPoolEntry>()

    for (const match of graph.matches) {
      if (match.team_a_id !== teamId && match.team_b_id !== teamId) continue
      if (match.winner_team_id === teamId) series.won++
      else if (match.winner_team_id) series.lost++

      for (const map of mapsByMatch.get(match.id) ?? []) {
        const won = teamWonMap(map, match, teamId)
        if (won === null) continue
        if (won) maps.won++
        else maps.lost++
        const [rw, rl] = teamRounds(map, match, teamId)
        roundsWon += rw
        roundsLost += rl
        const name = map.map_name?.trim()
        if (name) {
          const entry = pool.get(name) ?? { map: name, played: 0, won: 0 }
          entry.played++
          if (won) entry.won++
          pool.set(name, entry)
        }
      }
    }

    // Only rows on maps that still count (voided maps are absent from the graph).
    const teamRows = graph.rows.filter(
      (r) => r.team_id === teamId && mapById.has(r.match_map_id) && matchById.has(r.match_id)
    )

    return {
      teamId,
      series,
      maps,
      roundsWon,
      roundsLost,
      stats: aggregateRows(teamRows),
      mapPool: [...pool.values()].sort((a, b) => b.played - a.played || a.map.localeCompare(b.map)),
    }
  })

  const pairs = pairsOf(teamIds).map(([a, b]): TeamPair => {
    const series: Record2 = { won: 0, lost: 0 }
    const maps: Record2 = { won: 0, lost: 0 }
    const meetings: Meeting[] = []
    for (const match of graph.matches) {
      const sides = [match.team_a_id, match.team_b_id]
      if (!sides.includes(a) || !sides.includes(b)) continue
      if (match.winner_team_id === a) series.won++
      else if (match.winner_team_id === b) series.lost++
      for (const map of mapsByMatch.get(match.id) ?? []) {
        const won = teamWonMap(map, match, a)
        if (won === true) maps.won++
        else if (won === false) maps.lost++
      }
      const [scoreA, scoreB] = seriesScore(match, a)
      meetings.push({
        matchId: match.id,
        scheduledAt: match.scheduled_at,
        scoreA,
        scoreB,
        teamA: a,
        teamB: b,
      })
    }
    return { a, b, series, maps, meetings: meetings.sort(byDateDesc) }
  })

  return { summaries, pairs }
}

/**
 * Drop roster dates that cannot describe who played. Past seasons' rosters
 * were typed in long after the matches, so their `joined_at` is the entry
 * date: any date later than the team's last match is cleared, which leaves
 * the spot covering the whole season. Rosters kept live keep their dates, so
 * a mid-season move still counts.
 */
export function normalizeRosterDates(spots: RosterSpot[], matches: GraphMatch[]): RosterSpot[] {
  const lastMatch = new Map<string, string>()
  for (const m of matches) {
    if (!m.scheduled_at) continue
    for (const team of [m.team_a_id, m.team_b_id]) {
      const prev = lastMatch.get(team)
      if (!prev || m.scheduled_at > prev) lastMatch.set(team, m.scheduled_at)
    }
  }
  return spots.map((spot) => {
    const last = lastMatch.get(spot.team_id)
    if (!last) return spot
    return {
      ...spot,
      joined_at: spot.joined_at && spot.joined_at > last ? null : spot.joined_at,
      left_at: spot.left_at && spot.left_at > last ? null : spot.left_at,
    }
  })
}

/** Was this roster spot held when the match was played? Unknown dates count as held. */
function spotCovers(spot: RosterSpot, when: string | null): boolean {
  if (!when) return true
  if (spot.joined_at && when < spot.joined_at) return false
  if (spot.left_at && when > spot.left_at) return false
  return true
}

/**
 * Which side of the match a player was on, by roster: the team they were on
 * at the time, or null if they were on neither (or, oddly, both).
 */
function rosterSide(match: GraphMatch, spots: RosterSpot[] | undefined): string | null {
  if (!spots) return null
  const onA = spots.some((s) => s.team_id === match.team_a_id && spotCovers(s, match.scheduled_at))
  const onB = spots.some((s) => s.team_id === match.team_b_id && spotCovers(s, match.scheduled_at))
  if (onA === onB) return null
  return onA ? match.team_a_id : match.team_b_id
}

export function comparePlayers(profileIds: string[], graph: MatchGraph): { pairs: PlayerPair[] } {
  const { matchById, mapById } = indexGraph(graph)
  const wanted = new Set(profileIds)

  // Matches with any per-map stats are judged by who actually played each
  // map; the rest fall back to rosters below.
  const matchesWithRows = new Set(graph.rows.map((r) => r.match_id))
  const spotsByPlayer = new Map<string, RosterSpot[]>()
  for (const spot of graph.rosters) {
    if (!wanted.has(spot.profile_id)) continue
    const list = spotsByPlayer.get(spot.profile_id) ?? []
    list.push(spot)
    spotsByPlayer.set(spot.profile_id, list)
  }

  // Each selected player's row per map. A player appears once per map; if a
  // bad import gave them two, the first wins.
  const rowByMapAndPlayer = new Map<string, Map<string, GraphMapRow>>()
  for (const row of graph.rows) {
    if (!row.profile_id || !wanted.has(row.profile_id)) continue
    if (!mapById.has(row.match_map_id) || !matchById.has(row.match_id)) continue
    const perMap = rowByMapAndPlayer.get(row.match_map_id) ?? new Map<string, GraphMapRow>()
    if (!perMap.has(row.profile_id)) perMap.set(row.profile_id, row)
    rowByMapAndPlayer.set(row.match_map_id, perMap)
  }

  const pairs = pairsOf(profileIds).map(([a, b]): PlayerPair => {
    const against = { maps: 0, won: 0, lost: 0 }
    const together = { maps: 0, won: 0, lost: 0 }
    const rowsA: GraphMapRow[] = []
    const rowsB: GraphMapRow[] = []
    const meetingMatches = new Map<string, { teamA: string | null; teamB: string | null }>()

    for (const [mapId, perMap] of rowByMapAndPlayer) {
      const rowA = perMap.get(a)
      const rowB = perMap.get(b)
      if (!rowA || !rowB || !rowA.team_id || !rowB.team_id) continue
      const map = mapById.get(mapId)!
      const match = matchById.get(map.match_id)!
      const wonA = teamWonMap(map, match, rowA.team_id)

      if (rowA.team_id === rowB.team_id) {
        together.maps++
        if (wonA === true) together.won++
        else if (wonA === false) together.lost++
      } else {
        against.maps++
        if (wonA === true) against.won++
        else if (wonA === false) against.lost++
        rowsA.push(rowA)
        rowsB.push(rowB)
        if (!meetingMatches.has(match.id))
          meetingMatches.set(match.id, { teamA: rowA.team_id, teamB: rowB.team_id })
      }
    }

    // Matches with no per-map stats: sides come from the rosters, and the
    // series score stands in for maps (it is the count of maps each side won).
    let fromRosters = 0
    for (const match of graph.matches) {
      if (matchesWithRows.has(match.id)) continue
      const sideA = rosterSide(match, spotsByPlayer.get(a))
      const sideB = rosterSide(match, spotsByPlayer.get(b))
      if (!sideA || !sideB) continue
      const [mapsA, mapsB] = seriesScore(match, sideA)
      fromRosters++
      if (sideA === sideB) {
        together.maps += mapsA + mapsB
        together.won += mapsA
        together.lost += mapsB
      } else {
        against.maps += mapsA + mapsB
        against.won += mapsA
        against.lost += mapsB
        meetingMatches.set(match.id, { teamA: sideA, teamB: sideB })
      }
    }

    const againstSeries: Record2 = { won: 0, lost: 0 }
    const meetings: Meeting[] = []
    for (const [matchId, sides] of meetingMatches) {
      const match = matchById.get(matchId)!
      if (sides.teamA && match.winner_team_id === sides.teamA) againstSeries.won++
      else if (sides.teamB && match.winner_team_id === sides.teamB) againstSeries.lost++
      const [scoreA, scoreB] = sides.teamA ? seriesScore(match, sides.teamA) : [0, 0]
      meetings.push({
        matchId,
        scheduledAt: match.scheduled_at,
        scoreA,
        scoreB,
        teamA: sides.teamA,
        teamB: sides.teamB,
      })
    }

    return {
      a,
      b,
      against,
      againstSeries,
      statsA: aggregateRows(rowsA),
      statsB: aggregateRows(rowsB),
      together,
      meetings: meetings.sort(byDateDesc),
      fromRosters,
    }
  })

  return { pairs }
}
