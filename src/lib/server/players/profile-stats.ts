import { average, sum, weightedAverage } from '$lib/server/math'
import type { NormalizedRivalsGroupStatBatch } from '$lib/server/stats/rivals-batch'

/* Row shapes and per-map aggregation for the player profile page. */

export type StatBatchInfo = Partial<NormalizedRivalsGroupStatBatch> & {
  id: string
  display_name: string
}

export type StatRow = {
  import_batch_id: string
  imported_at?: string | null
  [key: string]: unknown
}

export type NormalizedStatRow = StatRow & { batch: StatBatchInfo }

export type TeamLite = {
  id: string
  name: string
  tag?: string | null
  logo_path?: string | null
  logo_url?: string | null
}

export type MatchRel = {
  id: string
  season_id?: string | null
  status?: string | null
  approval_status?: string | null
  scheduled_at?: string | null
  ended_at?: string | null
  team_a_id?: string | null
  team_b_id?: string | null
  team_a_score?: number | null
  team_b_score?: number | null
  winner_team_id?: string | null
  team_a?: TeamLite | TeamLite[] | null
  team_b?: TeamLite | TeamLite[] | null
}

export type ParticipatedRow = {
  id?: string | number | null
  match_id?: string | null
  profile_id?: string | null
  player_name?: string | null
  puuid?: string | null
  team_id?: string | null
  metadata?: Record<string, unknown> | null
  agents?: string | null
  acs?: number | null
  kills?: number | null
  deaths?: number | null
  assists?: number | null
  kd?: number | null
  adr?: number | null
  kast_pct?: number | null
  hs_pct?: number | null
  matches?: MatchRel | MatchRel[] | null
}

export type MatchHistoryEntry = {
  match: MatchRel | null
  team_id: string | null
  is_sub: boolean
  opponent: TeamLite | null
  score: { us: number; them: number }
  agents: string | null
  acs: number | null
  kills: number | null
  deaths: number | null
  assists: number | null
  kd: number | null
  adr: number | null
  kast_pct: number | null
  hs_pct: number | null
}

export type AggregatedStatEntry = {
  key: string
  maps_played: number
  maps_won: number
  /** Maps with a determinable winner — the denominator behind win_pct. */
  maps_decided: number
  win_pct: number | null
  rounds: number
  acs: number | null
  kills: number
  deaths: number
  assists: number
  kd: number | null
  adr: number | null
  kast_pct: number | null
  hs_pct: number | null
  fk: number
  fd: number
}

export type PerMapStatRow = {
  match_id: string | null
  team_id: string | null
  puuid?: string | null
  player_name?: string | null
  agents: string | null
  acs: number | null
  kills: number | null
  deaths: number | null
  assists: number | null
  kd: number | null
  adr: number | null
  kast_pct: number | null
  hs_pct: number | null
  rounds: number | null
  fk: number | null
  fd: number | null
  plants: number | null
  defuses: number | null
  match_maps: {
    map_name: string | null
    is_voided: boolean
    team_a_rounds: number | null
    team_b_rounds: number | null
    matches: {
      team_a_id: string | null
      team_b_id: string | null
      season_id?: string | null
    } | null
  } | null
}

export function didWinMap(row: PerMapStatRow): boolean | null {
  const mm = Array.isArray(row.match_maps) ? row.match_maps[0] : row.match_maps
  if (!mm || !row.team_id) return null
  const match = Array.isArray(mm.matches) ? mm.matches[0] : mm.matches
  if (!match) return null

  // The player's team must be one of the two sides. Without this guard a row
  // whose team_id matches neither (a re-linked roster, a bad import) falls
  // through to the team-B branch and is scored against the wrong side.
  const isTeamA = row.team_id === match.team_a_id
  const isTeamB = row.team_id === match.team_b_id
  if (!isTeamA && !isTeamB) return null

  const aRounds = mm.team_a_rounds ?? 0
  const bRounds = mm.team_b_rounds ?? 0
  if (aRounds === bRounds) return null

  return isTeamA ? aRounds > bRounds : bRounds > aRounds
}

export function aggregateStats(rows: PerMapStatRow[]): Omit<AggregatedStatEntry, 'key'> {
  const totalKills = sum(rows.map((r) => r.kills))
  const totalDeaths = sum(rows.map((r) => r.deaths))

  // Evaluate each row once — didWinMap walks joined rows and was previously
  // called twice per row per aggregate.
  const outcomes = rows.map(didWinMap)
  const wins = outcomes.filter((o) => o === true).length
  // Maps with no determinable result are excluded from the percentage rather
  // than counted as losses, so `maps_decided` is the honest denominator.
  const decided = outcomes.filter((o) => o !== null).length

  return {
    maps_played: rows.length,
    maps_won: wins,
    maps_decided: decided,
    win_pct: decided > 0 ? (wins / decided) * 100 : null,
    rounds: sum(rows.map((r) => r.rounds)),
    acs: average(rows.map((r) => r.acs)),
    kills: totalKills,
    deaths: totalDeaths,
    assists: sum(rows.map((r) => r.assists)),
    kd: totalDeaths > 0 ? totalKills / totalDeaths : null,
    adr: weightedAverage(
      rows.map((r) => ({ adr: r.adr, rounds: r.rounds })),
      'adr',
      'rounds'
    ),
    kast_pct: weightedAverage(
      rows.map((r) => ({ kast_pct: r.kast_pct, rounds: r.rounds })),
      'kast_pct',
      'rounds'
    ),
    hs_pct: average(rows.map((r) => r.hs_pct)),
    fk: sum(rows.map((r) => r.fk)),
    fd: sum(rows.map((r) => r.fd)),
  }
}

/** Group per-map rows by map and by agent, aggregating each group. */
export function buildBreakdowns(rows: PerMapStatRow[]): {
  mapStats: AggregatedStatEntry[]
  agentStats: AggregatedStatEntry[]
} {
  const byMap = new Map<string, PerMapStatRow[]>()
  for (const r of rows) {
    const mm = Array.isArray(r.match_maps) ? r.match_maps[0] : r.match_maps
    const mapName = mm?.map_name ?? 'Unknown'
    const arr = byMap.get(mapName) ?? []
    arr.push(r)
    byMap.set(mapName, arr)
  }
  const mapStats: AggregatedStatEntry[] = Array.from(byMap.entries())
    .map(([mapName, rs]) => ({ key: mapName, ...aggregateStats(rs) }))
    .sort((a, b) => b.maps_played - a.maps_played)

  const byAgent = new Map<string, PerMapStatRow[]>()
  for (const r of rows) {
    const agents = String(r.agents ?? '')
      .split(/\s+/)
      .map((a) => a.trim())
      .filter(Boolean)
    for (const agent of agents.length > 0 ? agents : ['Unknown']) {
      const arr = byAgent.get(agent) ?? []
      arr.push(r)
      byAgent.set(agent, arr)
    }
  }
  const agentStats: AggregatedStatEntry[] = Array.from(byAgent.entries())
    .map(([agent, rs]) => ({ key: agent, ...aggregateStats(rs) }))
    .sort((a, b) => b.maps_played - a.maps_played)

  return { mapStats, agentStats }
}
