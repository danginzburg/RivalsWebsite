/**
 * Standings arithmetic, kept free of the database so it can be tested.
 *
 * Points are not a league-wide rule: only external tournaments award them
 * (3 per series win, nothing for a loss). Rivals seasons rank on series record
 * and carry zero points. Either way ties fall to map difference, then round
 * difference, then map wins — anything subtler (head to head, an admin ruling)
 * is what `rank_override` is for.
 */

export const POINTS_PER_SERIES_WIN = 3

/**
 * Which `matches.stage` values count toward the standings. Unfiled matches
 * (null) count: most regular-season results are imported before anyone sets a
 * stage, and leaving them out silently undercounts. Kickoff, play-ins and
 * playoffs are separate events with their own brackets.
 */
export const STANDINGS_STAGES: ReadonlyArray<string | null> = ['regular', null]

export type StandingsMatch = {
  id: string
  stage: string | null
  team_a_id: string
  team_b_id: string
  team_a_score: number | null
  team_b_score: number | null
  winner_team_id: string | null
  maps: Array<{
    team_a_rounds: number | null
    team_b_rounds: number | null
    is_voided?: boolean | null
  }>
}

export type StandingsLine = {
  matches_played: number
  wins: number
  losses: number
  map_wins: number
  map_losses: number
  round_wins: number
  round_losses: number
  round_diff: number
  points: number
}

export type StandingsAdjustment = {
  team_id: string
  wins: number
  losses: number
  map_wins: number
  map_losses: number
  round_diff: number
  points: number
  rank_override: number | null
  note?: string | null
}

export type ComputedStandingsRow = StandingsLine & {
  team_id: string
  rank: number
  /** Straight from the matches, before any correction. */
  auto: StandingsLine
  adjustment: StandingsAdjustment | null
}

function emptyLine(): StandingsLine {
  return {
    matches_played: 0,
    wins: 0,
    losses: 0,
    map_wins: 0,
    map_losses: 0,
    round_wins: 0,
    round_losses: 0,
    round_diff: 0,
    points: 0,
  }
}

function num(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function countsTowardStandings(stage: string | null | undefined): boolean {
  return STANDINGS_STAGES.includes(stage ?? null)
}

/** Each team's line from the matches alone. */
export type ScoringOptions = {
  /** Award POINTS_PER_SERIES_WIN per series win. Off for Rivals seasons. */
  awardPoints: boolean
}

export function tallyMatches(
  matches: StandingsMatch[],
  { awardPoints }: ScoringOptions = { awardPoints: true }
): Map<string, StandingsLine> {
  const lines = new Map<string, StandingsLine>()
  const lineFor = (teamId: string) => {
    let line = lines.get(teamId)
    if (!line) {
      line = emptyLine()
      lines.set(teamId, line)
    }
    return line
  }

  for (const match of matches) {
    if (!countsTowardStandings(match.stage)) continue
    const a = lineFor(match.team_a_id)
    const b = lineFor(match.team_b_id)
    a.matches_played += 1
    b.matches_played += 1

    if (match.winner_team_id === match.team_a_id) {
      a.wins += 1
      b.losses += 1
    } else if (match.winner_team_id === match.team_b_id) {
      b.wins += 1
      a.losses += 1
    }

    // The series score is the map count, and is the only thing a forfeit has.
    const aMaps = num(match.team_a_score)
    const bMaps = num(match.team_b_score)
    a.map_wins += aMaps
    a.map_losses += bMaps
    b.map_wins += bMaps
    b.map_losses += aMaps

    for (const map of match.maps) {
      if (map.is_voided) continue
      const aRounds = num(map.team_a_rounds)
      const bRounds = num(map.team_b_rounds)
      a.round_wins += aRounds
      a.round_losses += bRounds
      b.round_wins += bRounds
      b.round_losses += aRounds
    }
  }

  for (const line of lines.values()) {
    line.round_diff = line.round_wins - line.round_losses
    line.points = awardPoints ? line.wins * POINTS_PER_SERIES_WIN : 0
  }
  return lines
}

function applyAdjustment(
  auto: StandingsLine,
  adj: StandingsAdjustment | null,
  { awardPoints }: ScoringOptions
): StandingsLine {
  if (!adj) return { ...auto }
  const wins = auto.wins + adj.wins
  const losses = auto.losses + adj.losses
  return {
    ...auto,
    wins,
    losses,
    // Adjusted series still have to add up, or the "played" column disagrees
    // with the W-L next to it.
    matches_played: auto.matches_played + adj.wins + adj.losses,
    map_wins: auto.map_wins + adj.map_wins,
    map_losses: auto.map_losses + adj.map_losses,
    round_diff: auto.round_diff + adj.round_diff,
    points: auto.points + (awardPoints ? adj.wins * POINTS_PER_SERIES_WIN : 0) + adj.points,
  }
}

function compareLines(
  a: { line: StandingsLine; name: string },
  b: { line: StandingsLine; name: string }
): number {
  return (
    b.line.points - a.line.points ||
    b.line.wins - a.line.wins ||
    a.line.losses - b.line.losses ||
    // Tiebreakers: map differential, then raw map wins, then round differential.
    b.line.map_wins - b.line.map_losses - (a.line.map_wins - a.line.map_losses) ||
    b.line.map_wins - a.line.map_wins ||
    b.line.round_diff - a.line.round_diff ||
    a.name.localeCompare(b.name)
  )
}

/**
 * The full table: every team in `teams` gets a row, played or not, with
 * corrections applied and ranks assigned. Callers leave disbanded teams out of
 * `teams`; their matches still count for the opponents who played them.
 *
 * Pinned teams take their `rank_override` slot (clamped to the table size;
 * when two pin the same slot the better record keeps it and the other moves
 * down); everyone else fills the remaining slots in sort order.
 */
export function computeStandings(
  teams: Array<{ id: string; name: string }>,
  matches: StandingsMatch[],
  adjustments: StandingsAdjustment[],
  scoring: ScoringOptions = { awardPoints: true }
): ComputedStandingsRow[] {
  const tallies = tallyMatches(matches, scoring)
  const adjByTeam = new Map(adjustments.map((adj) => [adj.team_id, adj]))

  const entries = teams.map((team) => {
    const auto = tallies.get(team.id) ?? emptyLine()
    const adjustment = adjByTeam.get(team.id) ?? null
    return {
      team,
      name: team.name,
      auto,
      adjustment,
      line: applyAdjustment(auto, adjustment, scoring),
    }
  })
  entries.sort(compareLines)

  const size = entries.length
  const slots: Array<(typeof entries)[number] | null> = new Array(size).fill(null)
  const pinned = entries.filter((e) => e.adjustment?.rank_override)
  const floating = entries.filter((e) => !e.adjustment?.rank_override)

  for (const entry of pinned) {
    let slot = Math.min(entry.adjustment!.rank_override!, size) - 1
    while (slot < size && slots[slot]) slot += 1
    if (slot >= size) {
      // Every slot from the pin down is taken; settle for the first free one.
      slot = slots.findIndex((s) => s === null)
    }
    slots[slot] = entry
  }
  let next = 0
  for (const entry of floating) {
    while (slots[next]) next += 1
    slots[next] = entry
  }

  return slots.map((entry, index) => ({
    team_id: entry!.team.id,
    rank: index + 1,
    ...entry!.line,
    auto: entry!.auto,
    adjustment: entry!.adjustment,
  }))
}

type TiebreakLine = Pick<
  StandingsLine,
  'points' | 'wins' | 'losses' | 'map_wins' | 'map_losses' | 'round_diff'
>

/**
 * Whether round difference separated any two neighbouring teams, i.e. they
 * were level on everything ranked before it (points, record, map difference,
 * map wins) and their round differences differ. `lines` must be in rank order.
 *
 * The leaderboard only shows the column when this is true — otherwise it is a
 * number that changed nothing.
 */
export function roundDiffDecidesTies(lines: TiebreakLine[]): boolean {
  for (let i = 1; i < lines.length; i += 1) {
    const a = lines[i - 1]
    const b = lines[i]
    if (
      a.points === b.points &&
      a.wins === b.wins &&
      a.losses === b.losses &&
      a.map_wins - a.map_losses === b.map_wins - b.map_losses &&
      a.map_wins === b.map_wins &&
      a.round_diff !== b.round_diff
    ) {
      return true
    }
  }
  return false
}
