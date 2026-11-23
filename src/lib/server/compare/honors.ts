import type { TeamHistoryRow } from '$lib/server/players/team-history'

/** A finish, possibly shared ("5th–6th"), out of how many teams. */
export type Finish = { start: number; end: number; of: number }

export type PlayerHonors = {
  /** The finish in the one season compared; null across several seasons or when unplaced. */
  finish: Finish | null
  /** Across several seasons: the average finish (5th–6th counts as 5.5). */
  avgFinish: number | null
  /** Across several seasons: the best finish's first place. */
  bestFinish: number | null
  /** Finished seasons that placed the player's team. */
  placedSeasons: number
  championships: number
  mvps: number
}

/**
 * A player's finishes, titles and MVPs within the compared seasons, read from
 * their team history. A player who moved mid-season has a row per team; the
 * newest (listed first) stands for the season's finish, but a title or MVP on
 * any of that season's rows counts once.
 */
export function summarizeHonors(history: TeamHistoryRow[], seasonIds: string[]): PlayerHonors {
  const inScope = new Set(seasonIds)
  const finishBySeason = new Map<string, Finish>()
  const champSeasons = new Set<string>()
  const mvpSeasons = new Set<string>()

  for (const row of history) {
    const seasonId = row.season?.id
    if (!seasonId || !inScope.has(seasonId)) continue
    if (row.finish && !finishBySeason.has(seasonId)) finishBySeason.set(seasonId, row.finish)
    if (row.placement === 'champion') champSeasons.add(seasonId)
    if (row.is_mvp) mvpSeasons.add(seasonId)
  }

  const finishes = [...finishBySeason.values()]
  const single = seasonIds.length === 1
  return {
    finish: single ? (finishes[0] ?? null) : null,
    avgFinish:
      !single && finishes.length
        ? finishes.reduce((sum, f) => sum + (f.start + f.end) / 2, 0) / finishes.length
        : null,
    bestFinish: !single && finishes.length ? Math.min(...finishes.map((f) => f.start)) : null,
    placedSeasons: finishes.length,
    championships: champSeasons.size,
    mvps: mvpSeasons.size,
  }
}
