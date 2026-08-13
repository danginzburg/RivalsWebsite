export const MAX_TEAM_AVERAGE = 36.75
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
