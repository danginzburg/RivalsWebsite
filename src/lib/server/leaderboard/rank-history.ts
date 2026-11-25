import {
  computeStandings,
  countsTowardStandings,
  type ScoringOptions,
  type StandingsAdjustment,
  type StandingsMatch,
} from '$lib/server/leaderboard/compute'

/**
 * A team's standings rank at the end of each week of its season, replayed from
 * the same matches and arithmetic the calculated standings use.
 *
 * Adjustments (hand corrections, rank pins) carry no date, so they are applied
 * only to the newest point: that point then matches the table the team page
 * shows, and the earlier ones read "from the matches as they stood".
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export type RankPoint = {
  /** ISO date (YYYY-MM-DD) of the last day the point covers. */
  week_end: string
  rank: number
  /** Teams in the table, so a rank can be read as "of N". */
  of: number
  wins: number
  losses: number
  /**
   * Set once the playoffs have results: `rank` then holds the place the team
   * has locked (or finished in) and `of` the bracket size.
   */
  playoff?: {
    label: string
    best: number
    worst_start: number
    worst_end: number
    decided: boolean
  }
}

export type DatedStandingsMatch = StandingsMatch & { at: string | null }

/** Monday 00:00 UTC of the week holding `ms`. */
function weekStart(ms: number): number {
  const d = new Date(ms)
  const day = (d.getUTCDay() + 6) % 7
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)
}

export function weeklyRanks(
  teamId: string,
  teams: Array<{ id: string; name: string }>,
  matches: DatedStandingsMatch[],
  adjustments: StandingsAdjustment[],
  scoring: ScoringOptions,
  now: number = Date.now(),
  maxPoints = 12
): RankPoint[] {
  if (!teams.some((t) => t.id === teamId)) return []
  const counted = matches
    .filter((m) => m.at && countsTowardStandings(m.stage) && !m.out_of_group)
    .map((m) => ({ ...m, ms: Date.parse(m.at as string) }))
    .filter((m) => Number.isFinite(m.ms) && m.ms <= now)
    .sort((a, b) => a.ms - b.ms)
  if (counted.length === 0) return []

  const firstWeek = weekStart(counted[0].ms)
  const lastWeek = weekStart(now)
  const points: RankPoint[] = []

  for (let start = firstWeek; start <= lastWeek; start += WEEK_MS) {
    const end = start + WEEK_MS
    const isLatest = end > now
    const played = counted.filter((m) => m.ms < end)
    const table = computeStandings(teams, played, isLatest ? adjustments : [], scoring)
    const row = table.find((r) => r.team_id === teamId)
    if (!row) continue
    points.push({
      week_end: new Date(Math.min(end, now) - 1).toISOString().slice(0, 10),
      rank: row.rank,
      of: table.length,
      wins: row.wins,
      losses: row.losses,
    })
  }

  // Weeks before the team's first series all read "unranked tie" — drop them.
  const firstPlayed = points.findIndex((p) => p.wins + p.losses > 0)
  const fromFirst = firstPlayed === -1 ? [] : points.slice(firstPlayed)
  return fromFirst.slice(-maxPoints)
}

/**
 * Every team's rank from the standings matches played before `cutoff`, and
 * how many series it had played by then. The weekly Discord standings compare
 * this against a week earlier to show who moved.
 */
export function ranksAsOf(
  teams: Array<{ id: string; name: string }>,
  matches: DatedStandingsMatch[],
  adjustments: StandingsAdjustment[],
  scoring: ScoringOptions,
  cutoff: number
): Map<string, { rank: number; played: number }> {
  const played = matches.filter((m) => {
    if (!m.at || !countsTowardStandings(m.stage) || m.out_of_group) return false
    const ms = Date.parse(m.at)
    return Number.isFinite(ms) && ms < cutoff
  })
  const table = computeStandings(teams, played, adjustments, scoring)
  return new Map(table.map((r) => [r.team_id, { rank: r.rank, played: r.wins + r.losses }]))
}

/** Standings series (regular season, in group) played in [from, to). */
export function seriesPlayedBetween(matches: DatedStandingsMatch[], from: number, to: number) {
  return matches.filter((m) => {
    if (!m.at || !countsTowardStandings(m.stage) || m.out_of_group) return false
    const ms = Date.parse(m.at)
    return Number.isFinite(ms) && ms >= from && ms < to
  }).length
}
