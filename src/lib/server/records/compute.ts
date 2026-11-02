import { RECORD_CATEGORIES, RECORD_TOP_N } from '$lib/records/categories'
import { recordEntryKey } from './overrides'

/** Where a performance happened — shared by player and team candidates. */
export type RecordMapContext = {
  matchId: string
  matchMapId: string
  mapOrder: number
  mapName: string | null
  seasonId: string | null
  stage: string | null
  scheduledAt: string | null
}

export type PlayerPerformance = RecordMapContext & {
  statId: number
  profileId: string | null
  playerName: string | null
  puuid: string | null
  teamId: string | null
  opponentTeamId: string | null
  agents: string | null
  /** Raw stat columns; null means the source never recorded it (e.g. multikills on CSV rows). */
  stats: Record<string, number | null>
  rounds: number
  roundsWon: number
  roundsLost: number
  /** Kills on each opponent, keyed by their puuid — only Riot-imported maps carry it. */
  duels: Record<string, number> | null
}

type BestDuel = {
  value: number
  opponent: PlayerPerformance
  killsFor: number
  killsAgainst: number
}

/**
 * A player's most one-sided duel on a map: the opponent they out-killed by the
 * most, counting the kills each way between just the two of them. Each side
 * only stores its own kills, so the other direction is read from the
 * opponent's row. Null when the map has no kill feed or nobody was out-killed.
 */
function bestDuel(
  p: PlayerPerformance,
  mapPlayers: Map<string, PlayerPerformance>
): BestDuel | null {
  if (!p.duels || !p.puuid) return null
  let best: BestDuel | null = null
  for (const [puuid, killsFor] of Object.entries(p.duels)) {
    const opponent = mapPlayers.get(puuid)
    if (!opponent) continue
    const killsAgainst = opponent.duels?.[p.puuid] ?? 0
    const value = killsFor - killsAgainst
    if (value > 0 && (!best || value > best.value))
      best = { value, opponent, killsFor, killsAgainst }
  }
  return best
}

export type MapResult = RecordMapContext & {
  teamAId: string
  teamBId: string
  teamARounds: number
  teamBRounds: number
}

/** One row of `stat_records`, in insert shape. */
export type StatRecordRow = {
  category: string
  value: number
  holder_kind: 'player' | 'team'
  profile_id: string | null
  player_name: string | null
  puuid: string | null
  team_id: string | null
  opponent_team_id: string | null
  season_id: string | null
  match_id: string
  match_map_id: string
  player_match_map_stat_id: number | null
  map_name: string | null
  map_order: number
  agents: string | null
  stage: string | null
  achieved_at: string | null
  superseded_at: string | null
  superseded_by_value: number | null
  /**
   * Performances with this same value that did not make the list — set on the
   * last ranked row, the only one whose value can carry on past the cut.
   */
  tie_count: number
  /** 1..RECORD_TOP_N, best first. */
  rank: number | null
  context: Record<string, unknown>
}

type Candidate = {
  value: number
  ctx: RecordMapContext
  /** Final tiebreak so equal timestamps still order the same way every rebuild. */
  seq: number
  row: Omit<
    StatRecordRow,
    | 'category'
    | 'value'
    | 'achieved_at'
    | 'superseded_at'
    | 'superseded_by_value'
    | 'tie_count'
    | 'rank'
  >
}

function round(value: number, decimals: number) {
  const f = 10 ** decimals
  return Math.round(value * f) / f
}

function chronological(a: Candidate, b: Candidate) {
  const at = a.ctx.scheduledAt ? Date.parse(a.ctx.scheduledAt) : 0
  const bt = b.ctx.scheduledAt ? Date.parse(b.ctx.scheduledAt) : 0
  if (at !== bt) return at - bt
  if (a.ctx.matchId !== b.ctx.matchId) return a.ctx.matchId < b.ctx.matchId ? -1 : 1
  if (a.ctx.mapOrder !== b.ctx.mapOrder) return a.ctx.mapOrder - b.ctx.mapOrder
  return a.seq - b.seq
}

function toRow(c: Candidate, category: string, rank: number | null): StatRecordRow {
  return {
    ...c.row,
    category,
    value: c.value,
    achieved_at: c.ctx.scheduledAt,
    superseded_at: null,
    superseded_by_value: null,
    tie_count: 0,
    rank,
  }
}

function unique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))]
}

/**
 * The current top performances, best first. Equal values rank in the order
 * they were played — the first to reach a value is ahead of those who matched
 * it. When more performances share the last listed value than fit, the last
 * row counts the ones cut off.
 */
function topPerformances(candidates: Candidate[], category: string): StatRecordRow[] {
  const ranked = [...candidates].sort((a, b) => b.value - a.value || chronological(a, b))
  const top = ranked.slice(0, RECORD_TOP_N).map((c, i) => toRow(c, category, i + 1))
  const last = top.at(-1)
  if (last) {
    const cutOff = ranked.slice(RECORD_TOP_N).filter((c) => c.value === last.value)
    last.tie_count = cutOff.length
    // Who they are, so a signed-in player can be told they are among them.
    if (cutOff.length > 0) {
      last.context = {
        ...last.context,
        tied_off_profile_ids: unique(cutOff.map((c) => c.row.profile_id)),
        tied_off_puuids: unique(cutOff.map((c) => c.row.puuid)),
      }
    }
  }
  return top
}

function mapFields(ctx: RecordMapContext) {
  return {
    season_id: ctx.seasonId,
    match_id: ctx.matchId,
    match_map_id: ctx.matchMapId,
    map_name: ctx.mapName,
    map_order: ctx.mapOrder,
    stage: ctx.stage,
  }
}

/**
 * Every category's top performances, ready to replace a track's
 * `stat_records` with. `excluded` holds `${category}|${entryKey}` for
 * performances an admin hid, which then take no part — the next one moves up.
 */
export function computeStatRecords(
  performances: PlayerPerformance[],
  maps: MapResult[],
  excluded: ReadonlySet<string> = new Set()
): StatRecordRow[] {
  const rows: StatRecordRow[] = []

  // A map with no rounds is a placeholder, not a performance. More deaths than
  // rounds is impossible (one life per round) and only comes from a bad import
  // row, which would otherwise take several records at once.
  const plausible = performances.filter(
    (p) => p.rounds > 0 && (p.stats.deaths === null || (p.stats.deaths ?? 0) <= p.rounds)
  )

  // Who played each map, by puuid — what a head-to-head duel looks its opponent up in.
  const playersByMap = new Map<string, Map<string, PlayerPerformance>>()
  for (const p of plausible) {
    if (!p.puuid) continue
    if (!playersByMap.has(p.matchMapId)) playersByMap.set(p.matchMapId, new Map())
    playersByMap.get(p.matchMapId)!.set(p.puuid, p)
  }

  for (const category of RECORD_CATEGORIES) {
    let candidates: Candidate[]

    if (category.holder === 'player') {
      const column = category.column ?? category.key
      candidates = plausible.flatMap((p) => {
        const duel = category.headToHead
          ? bestDuel(p, playersByMap.get(p.matchMapId) ?? new Map())
          : null
        const raw = category.headToHead
          ? (duel?.value ?? null)
          : category.derive
            ? category.derive.value(p)
            : p.stats[column]
        if (raw === null || raw === undefined || !Number.isFinite(raw)) return []
        return [
          {
            value: round(raw, category.decimals),
            ctx: p,
            seq: p.statId,
            row: {
              holder_kind: 'player' as const,
              profile_id: p.profileId,
              player_name: p.playerName,
              puuid: p.puuid,
              team_id: p.teamId,
              opponent_team_id: p.opponentTeamId,
              player_match_map_stat_id: p.statId,
              agents: p.agents,
              ...mapFields(p),
              context: {
                kills: p.stats.kills ?? null,
                deaths: p.stats.deaths ?? null,
                assists: p.stats.assists ?? null,
                acs: p.stats.acs ?? null,
                rounds: p.rounds,
                rounds_won: p.roundsWon,
                rounds_lost: p.roundsLost,
                ...(duel
                  ? {
                      duel_opponent_name: duel.opponent.playerName,
                      duel_opponent_profile_id: duel.opponent.profileId,
                      duel_kills_for: duel.killsFor,
                      duel_kills_against: duel.killsAgainst,
                    }
                  : {}),
              },
            },
          },
        ]
      })
    } else {
      candidates = maps.flatMap((m, index) => {
        const total = m.teamARounds + m.teamBRounds
        if (total <= 0 || m.teamARounds === m.teamBRounds) return []
        const aWon = m.teamARounds > m.teamBRounds
        const value =
          category.key === 'map_margin' ? Math.abs(m.teamARounds - m.teamBRounds) : total
        return [
          {
            value,
            ctx: m,
            seq: index,
            row: {
              holder_kind: 'team' as const,
              profile_id: null,
              player_name: null,
              puuid: null,
              // The winner holds a team record; the loser is the opponent.
              team_id: aWon ? m.teamAId : m.teamBId,
              opponent_team_id: aWon ? m.teamBId : m.teamAId,
              player_match_map_stat_id: null,
              agents: null,
              ...mapFields(m),
              context: {
                rounds_won: Math.max(m.teamARounds, m.teamBRounds),
                rounds_lost: Math.min(m.teamARounds, m.teamBRounds),
              },
            },
          },
        ]
      })
    }

    const counted = candidates.filter(
      (c) =>
        !excluded.has(
          `${category.key}|${recordEntryKey(c.ctx.matchMapId, c.row.player_match_map_stat_id)}`
        )
    )
    rows.push(...topPerformances(counted, category.key))
  }

  return rows
}
