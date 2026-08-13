import { supabaseAdmin } from '$lib/supabase/admin'
import { TtlCache } from '$lib/server/cache'

/**
 * Standings position, keyed by team id.
 *
 * This is the team's rank in the full leaderboard — every team in the season,
 * not just the eight that made the bracket. Playoff seeding lives in
 * `$lib/server/seasons/seeds` and belongs only to bracket surfaces; anywhere a
 * team appears in league context (the match feed, a match page) the number
 * people expect is where that team sits in the standings.
 */
export type RankMap = Record<string, number>

/** Ranks change on each leaderboard import, not on each page view. */
const rankCache = new TtlCache<RankMap>({ ttlMs: 5 * 60_000, maxEntries: 50 })
/** Which import each season's standings should be read from. */
const batchIndexCache = new TtlCache<Map<string, string[]>>({ ttlMs: 5 * 60_000, maxEntries: 1 })

type EntryRow = { team_id: string; rank: number | null; import_batch_id: string | null }
type BatchRow = { id: string; season_id: string | null }

function toRankMap(rows: EntryRow[] | null | undefined): RankMap {
  const map: RankMap = {}
  for (const row of rows ?? []) {
    const rank = Number(row.rank)
    if (row.team_id && Number.isFinite(rank) && rank > 0) map[row.team_id] = rank
  }
  return map
}

/**
 * Candidate import batches per season, newest first.
 *
 * `leaderboard_entries` is append-only: an import adds a fresh set of rows and
 * leaves every previous set in place. Reading a season's entries directly
 * therefore merges a dozen historical imports into one map, where whichever row
 * happens to land last wins — the standings page avoids this by reading a
 * single batch, and so must this.
 *
 * Untagged imports (`season_id` null, which is what the Google Sheets importer
 * produces) are attributed to the active season. Without that, the newest
 * standings are invisible to every season and teams that only appear in them
 * show no rank at all.
 */
async function fetchBatchIndex(): Promise<Map<string, string[]>> {
  const [{ data: activeSeason }, { data: batches }] = await Promise.all([
    supabaseAdmin.from('seasons').select('id').eq('is_active', true).maybeSingle(),
    supabaseAdmin
      .from('stat_import_batches')
      .select('id, season_id, created_at, metadata')
      .filter('metadata->>import_type', 'eq', 'leaderboard_entries')
      .eq('status', 'applied')
      .order('created_at', { ascending: false }),
  ])

  const activeSeasonId = activeSeason?.id ?? null
  const index = new Map<string, string[]>()
  for (const batch of (batches ?? []) as BatchRow[]) {
    const seasonId = batch.season_id ?? activeSeasonId
    if (!seasonId) continue
    const list = index.get(seasonId)
    if (list) list.push(batch.id)
    else index.set(seasonId, [batch.id])
  }
  return index
}

function getBatchIndex(): Promise<Map<string, string[]>> {
  return batchIndexCache.wrap('__index__', fetchBatchIndex)
}

/**
 * Ranks from the newest import that actually produced entries.
 *
 * Some applied batches hold no rows (a parse that matched nothing), and falling
 * back past them is the difference between showing last week's standings and
 * showing none.
 */
async function fetchSeasonRanks(seasonId: string): Promise<RankMap> {
  const candidates = (await getBatchIndex()).get(seasonId) ?? []
  if (candidates.length === 0) return {}

  const { data } = await supabaseAdmin
    .from('leaderboard_entries')
    .select('team_id, rank, import_batch_id')
    .in('import_batch_id', candidates)

  const byBatch = new Map<string, EntryRow[]>()
  for (const row of (data ?? []) as EntryRow[]) {
    if (!row.import_batch_id) continue
    const list = byBatch.get(row.import_batch_id)
    if (list) list.push(row)
    else byBatch.set(row.import_batch_id, [row])
  }

  // `candidates` is newest-first.
  for (const batchId of candidates) {
    const rows = byBatch.get(batchId)
    if (rows && rows.length > 0) return toRankMap(rows)
  }
  return {}
}

/** Standings ranks for one season. Empty when that season has no import. */
export async function getSeasonStandingsRanks(
  seasonId: string | null | undefined
): Promise<RankMap> {
  const resolved = seasonId ?? (await resolveActiveSeasonId())
  if (!resolved) return {}
  return rankCache.wrap(resolved, () => fetchSeasonRanks(resolved))
}

/** A match with no season of its own reads the active season's standings. */
async function resolveActiveSeasonId(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('seasons')
    .select('id')
    .eq('is_active', true)
    .maybeSingle()
  return data?.id ?? null
}

/**
 * Ranks across several seasons merged into one map.
 *
 * A team belongs to a single season, so ids do not collide — this lets a mixed
 * list such as the match feed resolve every team in one lookup.
 */
export async function getStandingsRanksForSeasons(
  seasonIds: Array<string | null | undefined>
): Promise<RankMap> {
  const keys = Array.from(new Set(seasonIds.map((id) => id ?? null)))
  if (keys.length === 0) return {}

  const maps = await Promise.all(keys.map((id) => getSeasonStandingsRanks(id)))
  return Object.assign({}, ...maps) as RankMap
}

/**
 * Drop cached ranks after a leaderboard import.
 *
 * Everything goes, not just the named season: the new import becomes that
 * season's newest batch (so the season→batch index is stale too), and an
 * untagged import lands on the active season whatever `_seasonId` says.
 */
export function invalidateStandingsRanks(_seasonId?: string | null) {
  batchIndexCache.clear()
  rankCache.clear()
}
