export const MAX_TEAM_AVERAGE = 36.5
export const MIN_TEAM_PLAYERS = 5
export const MAX_TEAM_PLAYERS = 8

export const TEAM_BALANCE_RANKS = [
  { name: 'Unranked', value: 0 },
  { name: 'Iron 1', value: 28 },
  { name: 'Iron 2', value: 28 },
  { name: 'Iron 3', value: 28 },
  { name: 'Bronze 1', value: 28 },
  { name: 'Bronze 2', value: 28 },
  { name: 'Bronze 3', value: 28 },
  { name: 'Silver 1', value: 29 },
  { name: 'Silver 2', value: 29 },
  { name: 'Silver 3', value: 29 },
  { name: 'Gold 1', value: 30 },
  { name: 'Gold 2', value: 30 },
  { name: 'Gold 3', value: 30 },
  { name: 'Platinum 1', value: 30.5 },
  { name: 'Platinum 2', value: 31.5 },
  { name: 'Platinum 3', value: 32.5 },
  { name: 'Diamond 1', value: 33.5 },
  { name: 'Diamond 2', value: 34.5 },
  { name: 'Diamond 3', value: 35.5 },
  { name: 'Ascendant 1', value: 36.5 },
  { name: 'Ascendant 2', value: 38 },
  { name: 'Ascendant 3', value: 39.5 },
  { name: 'Immortal 0RR', value: 41 },
  { name: 'Immortal 100RR', value: 43 },
  { name: 'Immortal 200RR', value: 45 },
  { name: 'Immortal 300RR', value: 46 },
  { name: 'Radiant 450RR', value: 48 },
  { name: 'Radiant 600RR', value: 49 },
  { name: 'Radiant 750+RR', value: 50 },
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
