import { supabaseAdmin } from '$lib/supabase/admin'
import { fetchAllRows } from '$lib/server/supabase/fetch-all'
import { aggregateFullSeasonRows } from '$lib/server/stats/aggregate-full-season'
import { currentRiotIdsByPuuid } from '$lib/server/players/directory'

/**
 * Keep "All Time (NA)" current as Rivals continues.
 *
 * The batch is two halves summed into one line per player:
 *   - CSV era: Seasons 1-4 predate match imports. Their totals only exist as
 *     uploaded `rivals_group_stats` batches, listed by UUID in the batch's
 *     `metadata.source_season_batches` (see
 *     `supabase/queries/set_all_time_na_source_batches.sql`). That list is
 *     frozen history and never needs touching again.
 *   - Match era: every later Rivals season is read straight from
 *     `player_match_map_stats` — approved matches with advanced stats, the same
 *     filter the batch generator uses. Reading maps rather than generated
 *     batches is deliberate: a season can have overlapping generated batches
 *     ("Kickoff", "Playoffs", a whole-season one), and summing those would
 *     double-count. Maps are counted exactly once.
 *
 * CSV-era seasons are excluded from the match half by code, so a Season 4
 * match that was later re-imported from a tracker link cannot double up with
 * the Season 4 CSV. External tournaments are excluded by `seasons.kind`.
 *
 * Rebuilt on every match import or edit (`refreshLiveBatchesForMatch`), so a
 * new season needs no setup at all — its first approved match lands here.
 */

/** Seasons whose stats come from CSV batches, not match imports. */
const DEFAULT_CSV_ERA_SEASON_CODES = ['rivals1', 'rivals2', 'rivals3', 'rivals4']

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Columns read from CSV-era batches. */
const BATCH_ROW_SELECT =
  'id, player_name, profile_id, agents, games, games_won, games_lost, rounds, rounds_won, rounds_lost, acs, kd, kast_pct, adr, kills, deaths, assists, fk, fd, hs_pct, econ_rating, plants, defuses, mk_2k, mk_3k, mk_4k, mk_5k, mk_6k, mk_7k, clutches_won, clutches_attempted'

/** Columns read from imported maps. */
const MAP_ROW_SELECT =
  'id, match_id, player_name, profile_id, puuid, agents, games, games_won, games_lost, rounds, rounds_won, rounds_lost, acs, kd, kast_pct, adr, kills, deaths, assists, fk, fd, hs_pct, econ_rating, plants, defuses, mk_2k, mk_3k, mk_4k, mk_5k, mk_6k, mk_7k, clutches_won, clutches_attempted'

/** Only match imports record these; the CSV era leaves them null. */
const ADVANCED_FIELDS = [
  'mk_2k',
  'mk_3k',
  'mk_4k',
  'mk_5k',
  'mk_6k',
  'mk_7k',
  'clutches_won',
  'clutches_attempted',
] as const

/** Keeps `.in()` lists well under PostgREST's URL length limit. */
const IN_CHUNK = 200
const INSERT_CHUNK = 500

type Row = Record<string, unknown>

type AllTimeBatchRow = {
  id: string
  display_name: string | null
  uploaded_by_profile_id: string | null
  metadata: {
    source_season_batches?: unknown
    csv_era_season_codes?: unknown
  } & Record<string, unknown>
}

function stringList(value: unknown, test: (s: string) => boolean = () => true): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(value.filter((v): v is string => typeof v === 'string' && test(v.trim())))
  ).map((v) => v.trim())
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** A batch is an all-time batch when it is summed from other batches. */
export function isAllTimeBatch(metadata: unknown): boolean {
  const list = (metadata as { source_season_batches?: unknown } | null)?.source_season_batches
  return stringList(list, (s) => UUID_RE.test(s)).length > 0
}

/**
 * Lowercased name → profile id, for names that only ever appear under one
 * profile. CSV rows imported before a player claimed their profile carry a
 * NULL `profile_id`, and without this they would sit on a second line beside
 * that player's match-era totals.
 */
function claimUnlinkedRows(rows: Row[]): void {
  const profilesByName = new Map<string, Set<string>>()
  for (const row of rows) {
    const profileId = typeof row.profile_id === 'string' ? row.profile_id : null
    const name = typeof row.player_name === 'string' ? row.player_name.trim().toLowerCase() : ''
    if (!profileId || !name) continue
    const set = profilesByName.get(name) ?? new Set()
    set.add(profileId)
    profilesByName.set(name, set)
  }

  for (const row of rows) {
    if (typeof row.profile_id === 'string' && row.profile_id) continue
    const name = typeof row.player_name === 'string' ? row.player_name.trim().toLowerCase() : ''
    const owners = profilesByName.get(name)
    // Two profiles sharing a name is ambiguous — leave the row on its own.
    if (owners?.size === 1) row.profile_id = Array.from(owners)[0]
  }
}

/** Approved, advanced-stat maps from every Rivals season after the CSV era. */
async function loadMatchEraMapRows(
  csvEraCodes: string[]
): Promise<{ rows: Row[]; matchCount: number }> {
  const { data: seasons, error: seasonsError } = await supabaseAdmin
    .from('seasons')
    .select('id, code, kind')
  if (seasonsError) throw new Error(`Failed to load seasons: ${seasonsError.message}`)

  const csvEra = new Set(csvEraCodes)
  const seasonIds = (seasons ?? [])
    .filter((s) => s.kind !== 'external' && !csvEra.has(String(s.code ?? '')))
    .map((s) => s.id as string)
  if (seasonIds.length === 0) return { rows: [], matchCount: 0 }

  const matches = await fetchAllRows<{ id: string }>(() =>
    supabaseAdmin
      .from('matches')
      .select('id')
      .eq('approval_status', 'approved')
      .in('season_id', seasonIds)
      .order('id')
  ).catch((err: Error) => {
    throw new Error(`Failed to load matches: ${err.message}`)
  })

  const rows: Row[] = []
  for (const ids of chunk(
    matches.map((m) => m.id),
    IN_CHUNK
  )) {
    const page = await fetchAllRows<Row>(() =>
      supabaseAdmin
        .from('player_match_map_stats')
        .select(MAP_ROW_SELECT)
        .in('match_id', ids)
        .not('clutches_attempted', 'is', null)
        .order('id')
    ).catch((err: Error) => {
      throw new Error(`Failed to load map stats: ${err.message}`)
    })
    rows.push(...page)
  }

  return { rows, matchCount: new Set(rows.map((r) => r.match_id)).size }
}

export type AllTimeRebuildResult = {
  batchId: string
  displayName: string | null
  playerCount: number
  matchCount: number
}

/**
 * Rebuild one all-time batch in place. Same delete-then-insert order as
 * `regenerateStatsBatch`: a failure in between leaves it empty, never doubled.
 */
export async function rebuildAllTimeBatch(options: {
  batchId: string
  adminProfileId: string
}): Promise<AllTimeRebuildResult> {
  const { batchId, adminProfileId } = options

  const { data: batch, error: batchError } = await supabaseAdmin
    .from('stat_import_batches')
    .select('id, display_name, uploaded_by_profile_id, metadata')
    .eq('id', batchId)
    .maybeSingle<AllTimeBatchRow>()
  if (batchError) throw new Error(`Failed to load batch: ${batchError.message}`)
  if (!batch) throw new Error('Batch not found.')

  const sourceIds = stringList(batch.metadata?.source_season_batches, (s) => UUID_RE.test(s))
  if (sourceIds.length === 0) throw new Error('That batch has no source batches to sum.')
  if (sourceIds.includes(batchId)) throw new Error('An all-time batch cannot include itself.')

  const configuredCodes = stringList(batch.metadata?.csv_era_season_codes)
  const csvEraCodes = configuredCodes.length > 0 ? configuredCodes : DEFAULT_CSV_ERA_SEASON_CODES

  const csvRows = await fetchAllRows<Row>(() =>
    supabaseAdmin
      .from('rivals_group_stats')
      .select(BATCH_ROW_SELECT)
      .in('import_batch_id', sourceIds)
      .order('id')
  ).catch((err: Error) => {
    throw new Error(`Failed to load source batches: ${err.message}`)
  })

  const { rows: mapRows, matchCount } = await loadMatchEraMapRows(csvEraCodes)

  // Rows are summed by name when unclaimed, so a player who renamed between
  // maps is put under their current name first; otherwise each name is a line.
  const unclaimedPuuids = mapRows
    .filter((r) => !r.profile_id && typeof r.puuid === 'string' && r.puuid)
    .map((r) => r.puuid as string)
  const currentNames = await currentRiotIdsByPuuid(unclaimedPuuids)
  for (const row of mapRows) {
    if (row.profile_id || typeof row.puuid !== 'string') continue
    row.player_name = currentNames.get(row.puuid) ?? row.player_name
  }

  const allRows = [...csvRows, ...mapRows]
  claimUnlinkedRows(allRows)

  // Players with no match-era maps have no multikill or clutch data at all —
  // null says "not tracked", where the summed 0 would claim they never clutched.
  const keyOf = (row: Row) =>
    (typeof row.profile_id === 'string' && row.profile_id.trim()) ||
    (typeof row.player_name === 'string' ? row.player_name.trim().toLowerCase() : '')
  const trackedKeys = new Set(mapRows.map(keyOf))

  const now = new Date().toISOString()
  const statRows = aggregateFullSeasonRows(allRows, batchId).map(({ id, ...row }) => {
    const key = id.slice(batchId.length + 1)
    if (!trackedKeys.has(key)) for (const field of ADVANCED_FIELDS) row[field] = null
    return {
      ...row,
      imported_by_profile_id: batch.uploaded_by_profile_id ?? adminProfileId,
      imported_at: now,
    }
  })

  const { error: deleteError } = await supabaseAdmin
    .from('rivals_group_stats')
    .delete()
    .eq('import_batch_id', batchId)
  if (deleteError) throw new Error(`Failed to clear old stat rows: ${deleteError.message}`)

  for (const rows of chunk(statRows, INSERT_CHUNK)) {
    const { error: insertError } = await supabaseAdmin.from('rivals_group_stats').insert(rows)
    if (insertError) throw new Error(`Failed to insert stat rows: ${insertError.message}`)
  }

  const { error: updateError } = await supabaseAdmin
    .from('stat_import_batches')
    .update({
      row_count: statRows.length,
      accepted_count: statRows.length,
      rejected_count: 0,
      updated_at: now,
      metadata: {
        ...(batch.metadata ?? {}),
        csv_era_season_codes: csvEraCodes,
        match_era_match_count: matchCount,
        regenerated_at: now,
      },
    })
    .eq('id', batchId)
  if (updateError) throw new Error(`Failed to update batch: ${updateError.message}`)

  return { batchId, displayName: batch.display_name, playerCount: statRows.length, matchCount }
}

/** Rebuild every all-time batch. Called after each match import or edit. */
export async function refreshAllTimeBatches(options: {
  adminProfileId: string
}): Promise<AllTimeRebuildResult[]> {
  const { data: batches, error } = await supabaseAdmin
    .from('stat_import_batches')
    .select('id, metadata')
    .filter('metadata->>import_type', 'eq', 'rivals_group_stats')
    .not('metadata->source_season_batches', 'is', null)
    .limit(50)
  if (error) throw new Error(`Failed to load all-time batches: ${error.message}`)

  const results: AllTimeRebuildResult[] = []
  for (const batch of batches ?? []) {
    if (!isAllTimeBatch(batch.metadata)) continue
    results.push(
      await rebuildAllTimeBatch({
        batchId: batch.id as string,
        adminProfileId: options.adminProfileId,
      })
    )
  }
  return results
}
