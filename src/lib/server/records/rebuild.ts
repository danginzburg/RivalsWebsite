import { supabaseAdmin } from '$lib/supabase/admin'
import { fetchAllRows } from '$lib/server/supabase/fetch-all'
import { RECORD_CATEGORIES } from '$lib/records/categories'
import { loadRecordTracks, type RecordTrack } from './tracks'
import { CATEGORY_ENTRY_KEY } from './overrides'
import { resolveMatchStageKey } from '$lib/stats/sections'
import {
  computeStatRecords,
  type MapResult,
  type PlayerPerformance,
  type RecordMapContext,
} from './compute'

/** Match ids per `.in()` filter — keeps the request URL well under limits. */
const ID_CHUNK = 100

const STAT_COLUMNS = Array.from(
  new Set(
    RECORD_CATEGORIES.flatMap((c) => [
      ...(c.column ? [c.column] : []),
      ...(c.derive?.columns ?? []),
    ])
  )
)

const STAT_SELECT = [
  'id, match_id, match_map_id, profile_id, player_name, puuid, team_id, agents',
  'rounds, rounds_won, rounds_lost',
  // Head-to-head kill counts the Riot import keeps on each row.
  'duels:metadata->duels',
  ...STAT_COLUMNS,
].join(', ')

type MatchRow = {
  id: string
  season_id: string | null
  stage: string | null
  scheduled_at: string | null
  team_a_id: string
  team_b_id: string
  metadata: Record<string, unknown> | null
}

type MapRow = {
  id: string
  match_id: string
  map_order: number
  map_name: string | null
  team_a_rounds: number | null
  team_b_rounds: number | null
  is_voided: boolean | null
}

type StatRow = Record<string, unknown> & {
  id: number
  match_id: string
  match_map_id: string
  profile_id: string | null
  player_name: string | null
  puuid: string | null
  team_id: string | null
  agents: string | null
  rounds: number | null
  rounds_won: number | null
  rounds_lost: number | null
  duels: Record<string, number> | null
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function loadRecordInputs(seasonIds: string[]): Promise<{
  performances: PlayerPerformance[]
  maps: MapResult[]
}> {
  if (seasonIds.length === 0) return { performances: [], maps: [] }

  const matches = await fetchAllRows<MatchRow>(() =>
    supabaseAdmin
      .from('matches')
      .select('id, season_id, stage, scheduled_at, team_a_id, team_b_id, metadata')
      .in('season_id', seasonIds)
      .eq('approval_status', 'approved')
      .order('id', { ascending: true })
  )
  if (matches.length === 0) return { performances: [], maps: [] }

  const matchById = new Map(matches.map((m) => [m.id, m]))
  const matchIds = matches.map((m) => m.id)

  const mapRows: MapRow[] = []
  const statRows: StatRow[] = []
  for (const ids of chunk(matchIds, ID_CHUNK)) {
    mapRows.push(
      ...(await fetchAllRows<MapRow>(() =>
        supabaseAdmin
          .from('match_maps')
          .select('id, match_id, map_order, map_name, team_a_rounds, team_b_rounds, is_voided')
          .in('match_id', ids)
          .order('id', { ascending: true })
      ))
    )
    statRows.push(
      ...(await fetchAllRows<StatRow>(() =>
        supabaseAdmin
          .from('player_match_map_stats')
          // Built from the category list, so the client cannot type it; the rows are StatRow.
          .select(STAT_SELECT as '*')
          .in('match_id', ids)
          .order('id', { ascending: true })
      ))
    )
  }

  const contextByMapId = new Map<string, RecordMapContext>()
  const maps: MapResult[] = []
  for (const map of mapRows) {
    const match = matchById.get(map.match_id)
    // A voided map was replayed or thrown out; nothing on it should stand as a record.
    if (!match || map.is_voided) continue
    const ctx: RecordMapContext = {
      matchId: match.id,
      matchMapId: map.id,
      mapOrder: map.map_order,
      mapName: map.map_name,
      seasonId: match.season_id,
      stage: resolveMatchStageKey(match.stage, match.metadata?.designation),
      scheduledAt: match.scheduled_at,
    }
    contextByMapId.set(map.id, ctx)
    maps.push({
      ...ctx,
      teamAId: match.team_a_id,
      teamBId: match.team_b_id,
      teamARounds: map.team_a_rounds ?? 0,
      teamBRounds: map.team_b_rounds ?? 0,
    })
  }

  const performances: PlayerPerformance[] = []
  for (const row of statRows) {
    const ctx = contextByMapId.get(row.match_map_id)
    const match = matchById.get(row.match_id)
    if (!ctx || !match) continue
    const opponentTeamId =
      row.team_id === match.team_a_id
        ? match.team_b_id
        : row.team_id === match.team_b_id
          ? match.team_a_id
          : null
    performances.push({
      ...ctx,
      statId: row.id,
      profileId: row.profile_id,
      playerName: row.player_name,
      puuid: row.puuid,
      teamId: row.team_id,
      opponentTeamId,
      agents: row.agents,
      stats: Object.fromEntries(STAT_COLUMNS.map((c) => [c, num(row[c])])),
      rounds: num(row.rounds) ?? 0,
      roundsWon: num(row.rounds_won) ?? 0,
      roundsLost: num(row.rounds_lost) ?? 0,
      duels: row.duels && typeof row.duels === 'object' ? row.duels : null,
    })
  }

  return { performances, maps }
}

/** Performances an admin hid from a category, as `${category}|${entryKey}`. */
async function loadExcludedEntries(track: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from('stat_record_overrides')
    .select('category, entry_key')
    .eq('track', track)
    .eq('is_hidden', true)
    .neq('entry_key', CATEGORY_ENTRY_KEY)
  // Before the overrides migration there is nothing to exclude.
  if (error) {
    console.error('Failed to load hidden record entries:', error)
    return new Set()
  }
  return new Set((data ?? []).map((row) => `${row.category}|${row.entry_key}`))
}

async function rebuildTrack(track: RecordTrack): Promise<number> {
  const [{ performances, maps }, excluded] = await Promise.all([
    loadRecordInputs(track.seasonIds),
    loadExcludedEntries(track.key),
  ])
  const rows = computeStatRecords(performances, maps, excluded)

  const { data, error } = await supabaseAdmin.rpc('replace_stat_records', {
    p_track: track.key,
    p_rows: rows,
  })
  if (error) throw new Error(`Failed to replace ${track.key} stat records: ${error.message}`)

  return typeof data === 'number' ? data : rows.length
}

/**
 * Recompute the Rivals records, and the active side league's while one is
 * running, from the per-map stats. Each track is swapped in one transaction.
 * Run after any match import or edit; a full rebuild is cheap at league scale
 * and means a re-import or reassignment can never leave a record pointing at
 * stats that no longer exist. A finished side league's track is left as it was.
 */
export async function rebuildStatRecords(): Promise<{ recordCount: number }> {
  const { rivals, sideLeague } = await loadRecordTracks()
  let recordCount = await rebuildTrack(rivals)
  if (sideLeague) recordCount += await rebuildTrack(sideLeague)
  return { recordCount }
}
