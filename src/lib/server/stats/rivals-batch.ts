/** Raw row from `stat_import_batches` (rivals group stats imports). */
export type StatImportBatchRow = {
  id: string
  display_name?: string | null
  source_filename?: string | null
  import_kind?: string | null
  week_label?: string | null
  section?: string | null
  created_at?: string | null
  metadata?: { import_kind?: string; week_label?: string } | null
  sort_order?: number | null
}

/** Columns every rivals batch reader wants. */
export const RIVALS_BATCH_SELECT =
  'id, source_filename, display_name, import_kind, week_label, section, created_at, metadata, sort_order, row_count'

/** The same list before `section` existed. */
const RIVALS_BATCH_SELECT_LEGACY =
  'id, source_filename, display_name, import_kind, week_label, created_at, metadata, sort_order, row_count'

type QueryResult<T> = { data: T | null; error: { message?: string | null } | null }

/**
 * Run a batch query, retrying without `section` if the column is not there yet.
 *
 * Same shape as the `display_name` fallback in the stats import endpoint: the
 * migration is applied by hand against Supabase, so a deploy that lands first
 * must degrade to name inference rather than emptying the batch picker.
 */
export async function withSectionFallback<T>(
  run: (select: string) => PromiseLike<QueryResult<T>>
): Promise<QueryResult<T>> {
  const first = await run(RIVALS_BATCH_SELECT)
  if (!first.error) return first
  if (!/section/i.test(first.error.message ?? '')) return first
  return run(RIVALS_BATCH_SELECT_LEGACY)
}

export function extractNumericLabel(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const m = value.match(/(\d+)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

export function isLatestLabel(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return value.trim().toLowerCase().includes('latest')
}

/** Normalized rivals stat import batch for API and pages (`source_filename` is always present; may be null). */
export type NormalizedRivalsGroupStatBatch = {
  id: string
  display_name: string
  source_filename: string | null
  import_kind: string | null
  week_label: string | null
  /** Stored section key, or null when it has never been set. */
  section: string | null
  created_at?: string | null
  sort_order: number | null
}

/**
 * Map DB batch rows to a consistent client shape. `displayNameFallback` controls
 * how missing `display_name` is filled (`api_stats` default-batch picker uses `'empty'`).
 */
export function normalizeRivalsGroupStatBatchFromDb(
  b: StatImportBatchRow,
  opts: {
    displayNameFallback: 'empty' | 'source_filename'
  }
): NormalizedRivalsGroupStatBatch {
  const displayName =
    b.display_name ?? (opts.displayNameFallback === 'empty' ? '' : (b.source_filename ?? ''))

  return {
    id: b.id,
    display_name: displayName,
    source_filename: b.source_filename ?? null,
    import_kind: b.import_kind ?? b.metadata?.import_kind ?? null,
    week_label: b.week_label ?? b.metadata?.week_label ?? null,
    section: b.section ?? null,
    created_at: b.created_at,
    sort_order: b.sort_order ?? null,
  }
}
