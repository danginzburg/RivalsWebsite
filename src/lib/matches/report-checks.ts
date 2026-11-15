/**
 * Pure checks behind a captain result submission: whether the maps it names
 * add up to a finished series of the match's length. Kept free of the database
 * so the rule is testable on its own.
 */

export type ScoredMap = { teamARounds: number; teamBRounds: number }

/** Map wins per team, in order. */
export function seriesScore(maps: ScoredMap[]) {
  let a = 0
  let b = 0
  for (const map of maps) {
    if (map.teamARounds > map.teamBRounds) a += 1
    else if (map.teamBRounds > map.teamARounds) b += 1
  }
  return { a, b }
}

/**
 * Why the maps are not a finished best-of-`bestOf`, or null when they are:
 * every map has a winner, one team reached the winning count on the last map,
 * and no map was played after the series was decided.
 */
export function checkSeriesScore(maps: ScoredMap[], bestOf: number): string | null {
  if (!Number.isInteger(bestOf) || bestOf < 1) return 'The match has no valid best-of set.'
  const winsNeeded = Math.ceil(bestOf / 2)

  if (maps.length === 0) return 'No maps were submitted.'
  if (maps.length > bestOf) {
    return `${maps.length} maps were submitted for a best-of-${bestOf}.`
  }

  const tied = maps.findIndex((m) => m.teamARounds === m.teamBRounds)
  if (tied >= 0)
    return `Map ${tied + 1} has no winner (${maps[tied].teamARounds}-${maps[tied].teamBRounds}).`

  let a = 0
  let b = 0
  for (const [index, map] of maps.entries()) {
    if (a >= winsNeeded || b >= winsNeeded) {
      return `Map ${index + 1} was played after the series was already decided.`
    }
    if (map.teamARounds > map.teamBRounds) a += 1
    else b += 1
  }

  if (a < winsNeeded && b < winsNeeded) {
    return `The maps come to ${a}-${b}, which doesn't finish a best-of-${bestOf}.`
  }
  return null
}
