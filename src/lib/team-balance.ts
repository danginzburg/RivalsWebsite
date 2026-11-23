/**
 * Highest average signup score a five-player roster may have. Fixed in code:
 * change it here, not in the database.
 *
 * Signup scores run Iron 1 = 1 … Radiant = 25 plus up to ±3 performance bonus
 * (see `$lib/signups/formula`). Season 5's pool averages about 18.75, so 19 is
 * just above an average roster.
 */
export const TEAM_MAX_AVERAGE = 19

/**
 * Highest combined score of the Immortal-peak players on one roster (see
 * `isImmortalPeak`). At 65 three Immortal peaks fit only when all three are
 * Immortal 1-level; an Immortal 3 can share a roster with one other Immortal
 * peak at most.
 */
export const TEAM_MAX_IMMORTAL_TOTAL = 65

/** Peaked Immortal or Radiant since V26 Act 1: the players the Immortal cap counts. */
export function isImmortalPeak(peakRank: string | null | undefined): boolean {
  return !!peakRank && (peakRank.startsWith('Immortal') || peakRank === 'Radiant')
}

export const MIN_TEAM_PLAYERS = 5
export const MAX_TEAM_PLAYERS = 8

export const TEAM_BALANCE_RANKS = [
  { name: 'Iron 1', value: 1 },
  { name: 'Iron 2', value: 2 },
  { name: 'Iron 3', value: 3 },
  { name: 'Bronze 1', value: 4 },
  { name: 'Bronze 2', value: 5 },
  { name: 'Bronze 3', value: 6 },
  { name: 'Silver 1', value: 7 },
  { name: 'Silver 2', value: 8 },
  { name: 'Silver 3', value: 9 },
  { name: 'Gold 1', value: 10 },
  { name: 'Gold 2', value: 11 },
  { name: 'Gold 3', value: 12 },
  { name: 'Platinum 1', value: 13 },
  { name: 'Platinum 2', value: 14 },
  { name: 'Platinum 3', value: 15 },
  { name: 'Diamond 1', value: 16 },
  { name: 'Diamond 2', value: 17 },
  { name: 'Diamond 3', value: 18 },
  { name: 'Ascendant 1', value: 19 },
  { name: 'Ascendant 2', value: 20 },
  { name: 'Ascendant 3', value: 21 },
  { name: 'Immortal 1', value: 23 },
  { name: 'Immortal 2', value: 24 },
  { name: 'Immortal 3', value: 25 },
  { name: 'Radiant', value: 30 },
] as const

export type TeamBalanceRankName = (typeof TEAM_BALANCE_RANKS)[number]['name']

export function getRankValue(rankName: string): number {
  return TEAM_BALANCE_RANKS.find((r) => r.name === rankName)?.value ?? 0
}

export function computeTopFiveAverage(rankNames: string[]): number {
  const values = rankNames
    .map((name) => getRankValue(name))
    .sort((a, b) => b - a)
    .slice(0, MIN_TEAM_PLAYERS)

  if (values.length < MIN_TEAM_PLAYERS) return Infinity
  const total = values.reduce((sum, value) => sum + value, 0)
  return total / MIN_TEAM_PLAYERS
}
