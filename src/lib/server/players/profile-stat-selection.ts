import { supabaseAdmin } from '$lib/supabase/admin'
import { toBatchLabel } from '$lib/server/stats/batch-label'
import {
  extractNumericLabel,
  isLatestLabel,
  normalizeRivalsGroupStatBatchFromDb,
  runRivalsBatchQuery,
  type NormalizedRivalsGroupStatBatch,
  type StatImportBatchRow,
} from '$lib/server/stats/rivals-batch'
import { isWeekBatch } from '$lib/stats/sections'
import { resolveSeasonStatBatchIds, toFullSeasonBatchId } from '$lib/server/stats/season-batches'
import { aggregateFullSeasonRows } from '$lib/server/stats/aggregate-full-season'
import { groupBatchesByEvent } from '$lib/server/stats/batch-events'
import { rankValue } from '$lib/ranks/ranks'
import type { NormalizedStatRow, StatRow } from '$lib/server/players/profile-stats'

/**
 * Which leaderboard-stats row a player profile shows: shared by the profile
 * page and its link-preview card so both quote the same numbers.
 */

/** The `rivals_group_stats` columns the profile reads. */
export const PROFILE_STAT_COLUMNS =
  'id, player_name, profile_id, agents, games, games_won, games_lost, rounds, rounds_won, rounds_lost, acs, kd, kast_pct, adr, kills, deaths, assists, fk, fd, hs_pct, econ_rating, kpg, kpr, dpg, dpr, apg, apr, fkpg, fdpg, plants, plants_per_game, defuses, defuses_per_game, league_rank, import_batch_id, imported_at'

/** The `seasons` columns the selection needs. */
export const PROFILE_SEASON_COLUMNS = 'id, code, name, kind, metadata, starts_on, created_at'

export type ProfileSeasonRow = {
  id: string
  code?: string | null
  name?: string | null
  kind?: string | null
  metadata?: { stat_batches?: unknown } | null
}

function kindOrder(kind: unknown): number {
  return kind === 'aggregate' ? 0 : 1
}

/**
 * The player's stat rows with their batches (plus a summed "Full Season" line
 * per season), the batch picker, and the row to show: `selectedBatchId` when
 * it matches, else the newest imported aggregate.
 *
 * `statsRows` are the player's `rivals_group_stats` rows, newest first;
 * `allSeasons` is every season, newest first.
 */
export async function selectProfileStats(
  statsRows: StatRow[],
  allSeasons: ProfileSeasonRow[],
  selectedBatchId: string | null
) {
  const batchIds = Array.from(new Set(statsRows.map((r) => r.import_batch_id).filter(Boolean)))

  const { data: batches } = batchIds.length
    ? await runRivalsBatchQuery<Array<StatImportBatchRow & { season_id?: string | null }>>(
        (select) =>
          supabaseAdmin
            .from('stat_import_batches')
            .select(`${select}, season_id`)
            .in('id', batchIds)
            .order('created_at', { ascending: false })
            .returns<Array<StatImportBatchRow & { season_id?: string | null }>>()
      )
    : { data: [] }

  // Raw batch rows keyed by id, for the metadata/season lookup that scopes the
  // match-based Map/Agent tables below.
  type RawBatchRow = {
    id: string
    season_id?: string | null
    metadata?: { source_match_ids?: unknown } | null
  }
  const rawBatchById = new Map<string, RawBatchRow>()
  for (const b of (batches ?? []) as RawBatchRow[]) rawBatchById.set(b.id, b)

  // Week batches are not shown on the site, so their rows are dropped too.
  const batchById = new Map<string, NormalizedRivalsGroupStatBatch>()
  const weekBatchIds = new Set<string>()
  for (const b of batches ?? []) {
    const normalized = normalizeRivalsGroupStatBatchFromDb(b as StatImportBatchRow, {
      displayNameFallback: 'source_filename',
    })
    if (isWeekBatch(normalized)) weekBatchIds.add(b.id)
    else batchById.set(b.id, normalized)
  }

  const visibleStatRows = statsRows.filter((r) => !weekBatchIds.has(r.import_batch_id))

  // One "Full Season" line per season the player has phase rows in, summed the
  // same way the stats API sums its `season:<code>` batches so the two pages
  // agree. Nothing is stored under these ids.
  const fullSeasonStats: NormalizedStatRow[] = []
  for (const season of allSeasons) {
    if (!season.code) continue
    const sourceIds = new Set(resolveSeasonStatBatchIds(season))
    const rows = visibleStatRows.filter((r) => sourceIds.has(r.import_batch_id))
    if (rows.length === 0) continue
    const id = toFullSeasonBatchId(season.code)
    // Every row is this player's, so the sum is a single line.
    const [row] = aggregateFullSeasonRows(rows, id)
    if (!row) continue
    fullSeasonStats.push({
      ...row,
      batch: {
        id,
        display_name: `${season.name ?? 'Season'} (Full)`,
        source_filename: null,
        import_kind: 'aggregate',
        week_label: null,
        section: 'full',
        created_at: null,
        sort_order: null,
      },
    })
  }

  const sortedBatches = Array.from(batchById.values())
    .sort((a, b) => {
      const ka = kindOrder(a.import_kind)
      const kb = kindOrder(b.import_kind)
      if (ka !== kb) return ka - kb

      const ao = a.sort_order
      const bo = b.sort_order
      if (typeof ao === 'number' && typeof bo === 'number' && ao !== bo) return ao - bo
      if (typeof ao === 'number' && typeof bo !== 'number') return -1
      if (typeof ao !== 'number' && typeof bo === 'number') return 1

      const ta = a.created_at ? new Date(a.created_at).getTime() : 0
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0
      if (ta !== tb) return tb - ta

      return toBatchLabel(a).localeCompare(toBatchLabel(b))
    })
    .map((b) => ({
      id: b.id,
      display_name: toBatchLabel(b),
      section: b.section ?? null,
      import_kind: b.import_kind ?? null,
      week_label: b.week_label ?? null,
    }))
  // Same event-then-phase picker as the stats page.
  const { batches: pickerBatches, events: batchEvents } = groupBatchesByEvent(
    [
      ...fullSeasonStats.map((r) => ({
        id: r.batch.id,
        display_name: r.batch.display_name,
        section: 'full',
        import_kind: 'aggregate',
        week_label: null,
      })),
      ...sortedBatches,
    ],
    allSeasons,
    (batches ?? []) as RawBatchRow[]
  )

  const normalizedStats: NormalizedStatRow[] = [
    ...fullSeasonStats,
    ...visibleStatRows.map((r) => ({
      ...r,
      batch: batchById.get(r.import_batch_id) ?? {
        id: r.import_batch_id,
        display_name: r.import_batch_id,
      },
    })),
  ]

  let selected: NormalizedStatRow | null = null
  if (selectedBatchId) {
    selected = normalizedStats.find((r) => r.import_batch_id === selectedBatchId) ?? null
  }

  if (!selected) {
    const byBatchId = new Map<string, NormalizedStatRow>()
    for (const r of normalizedStats) {
      if (!r.import_batch_id) continue
      if (byBatchId.has(r.import_batch_id)) continue
      byBatchId.set(r.import_batch_id, r)
    }

    const aggregates = Array.from(byBatchId.values()).filter(
      // Full Season lines stay opt-in; the default is still an imported batch.
      (r) => r.batch?.import_kind === 'aggregate' && r.batch?.section !== 'full'
    )

    function sortBatches(a: NormalizedStatRow, b: NormalizedStatRow) {
      const ao = a.batch?.sort_order
      const bo = b.batch?.sort_order
      if (typeof ao === 'number' && typeof bo === 'number' && ao !== bo) return ao - bo
      if (typeof ao === 'number' && typeof bo !== 'number') return -1
      if (typeof ao !== 'number' && typeof bo === 'number') return 1

      const aName = a.batch?.display_name ?? ''
      const bName = b.batch?.display_name ?? ''

      const aLatest = isLatestLabel(aName)
      const bLatest = isLatestLabel(bName)
      if (aLatest !== bLatest) return aLatest ? -1 : 1

      const na = extractNumericLabel(aName)
      const nb = extractNumericLabel(bName)
      if (na !== null && nb !== null && na !== nb) return nb - na

      // When either side lacks a numeric label, fall back to time ordering instead of
      // always preferring the numeric-labeled batch.
      const ta = a.batch?.created_at ? new Date(a.batch.created_at).getTime() : 0
      const tb = b.batch?.created_at ? new Date(b.batch.created_at).getTime() : 0
      if (ta !== tb) return tb - ta

      const ia = a.imported_at ? new Date(a.imported_at).getTime() : 0
      const ib = b.imported_at ? new Date(b.imported_at).getTime() : 0
      if (ia !== ib) return ib - ia

      return String(aName).localeCompare(String(bName))
    }

    aggregates.sort(sortBatches)

    selected = aggregates[0] ?? normalizedStats[0] ?? null
  }

  return { normalizedStats, selected, pickerBatches, batchEvents, rawBatchById }
}

/**
 * All-time peak: the highest rank on any of the player's stat rows (ranks
 * assigned in stat imports) or any tournament rank recorded for one of their
 * Riot accounts (the peak they held during each tournament's dates).
 */
export async function loadPeakRank(
  statRows: Array<{ league_rank?: unknown }>,
  riotAccounts: Array<{ status?: string | null; riot_puuid?: string | null }>
): Promise<string | null> {
  const accountPuuids = riotAccounts
    .filter((a) => a.status !== 'rejected' && a.riot_puuid)
    .map((a) => a.riot_puuid as string)
  const { data: seasonRanks } = accountPuuids.length
    ? await supabaseAdmin.from('riot_season_ranks').select('rank').in('puuid', accountPuuids)
    : { data: [] }
  let bestRank: string | null = null
  let bestRankValue = 0
  for (const raw of [
    ...statRows.map((r) => r.league_rank as string | null),
    ...(seasonRanks ?? []).map((r) => r.rank as string),
  ]) {
    if (!raw) continue
    const v = rankValue(raw)
    if (v > bestRankValue) {
      bestRankValue = v
      bestRank = raw
    }
  }
  return bestRank
}
