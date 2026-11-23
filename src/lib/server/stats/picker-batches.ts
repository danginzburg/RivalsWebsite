import { supabaseAdmin } from '$lib/supabase/admin'
import {
  normalizeRivalsGroupStatBatchFromDb,
  runRivalsBatchQuery,
  type NormalizedRivalsGroupStatBatch,
  type StatImportBatchRow,
} from '$lib/server/stats/rivals-batch'
import { resolveSeasonStatBatchIds, toFullSeasonBatchId } from '$lib/server/stats/season-batches'
import { groupBatchesByEvent, type BatchEvent } from '$lib/server/stats/batch-events'
import { isAllTimeBatch } from '$lib/server/stats/all-time'
import { isWeekBatch } from '$lib/stats/sections'

export type PickerBatch = NormalizedRivalsGroupStatBatch & { event: string }

/**
 * Every stats table a visitor can pick, grouped by event for `BatchPicker`:
 * the imported `rivals_group_stats` batches plus one synthetic "Full Season"
 * entry per season. Shared by /stats and /compare so both offer the same list.
 */
export async function loadPickerBatches(): Promise<{
  batches: PickerBatch[]
  events: BatchEvent[]
  /** The generated "All Time" batch, when there is one: the natural default for career comparisons. */
  allTimeBatchId: string | null
  /** Every season, newest first, for mapping a batch's event back to its season. */
  seasons: Array<{ id: string; name: string | null; kind: string | null }>
}> {
  let batches: NormalizedRivalsGroupStatBatch[] = []
  const { data: batchRows, error: batchError } = await runRivalsBatchQuery<StatImportBatchRow[]>(
    (select) =>
      supabaseAdmin
        .from('stat_import_batches')
        .select(select)
        .filter('metadata->>import_type', 'eq', 'rivals_group_stats')
        // A live batch created before its event has no rows yet. It is real and
        // editable in admin, but listing an empty "Season 5 Playoffs" for
        // visitors is just a dead end.
        .gt('row_count', 0)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(100)
        .returns<StatImportBatchRow[]>()
  )

  if (!batchError) {
    batches = (batchRows ?? [])
      .map((b: StatImportBatchRow) =>
        normalizeRivalsGroupStatBatchFromDb(b, {
          displayNameFallback: 'source_filename',
        })
      )
      .filter((b) => !isWeekBatch(b))
  }

  // One synthetic "Full Season" entry per season whose phase batches are present
  // in the list above. These carry no DB row — the API sums them on demand from
  // the `season:<code>` id — so they are prepended to the picker rather than
  // read from `stat_import_batches`.
  const presentBatchIds = new Set(batches.map((b) => b.id))
  const { data: seasonRows } = await supabaseAdmin
    .from('seasons')
    .select('id, code, name, kind, metadata, starts_on, created_at')
    .order('starts_on', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  const fullSeasonBatches: NormalizedRivalsGroupStatBatch[] = (seasonRows ?? [])
    .filter((s) => {
      const ids = resolveSeasonStatBatchIds(s)
      return ids.length > 0 && ids.some((id) => presentBatchIds.has(id))
    })
    .map((s) => ({
      id: toFullSeasonBatchId(s.code as string),
      display_name: `${(s.name as string | null) ?? 'Season'} (Full)`,
      source_filename: null,
      import_kind: 'aggregate',
      week_label: null,
      section: 'full',
      created_at: null,
      sort_order: null,
    }))

  const grouped = groupBatchesByEvent(
    [...fullSeasonBatches, ...batches],
    seasonRows ?? [],
    batchRows ?? []
  )

  const allTime = (batchRows ?? []).find(
    (b) => presentBatchIds.has(b.id) && isAllTimeBatch(b.metadata)
  )

  return {
    ...grouped,
    allTimeBatchId: allTime?.id ?? null,
    seasons: (seasonRows ?? []).map((s) => ({
      id: s.id as string,
      name: (s.name as string | null) ?? null,
      kind: (s.kind as string | null) ?? null,
    })),
  }
}
