/**
 * Which of a season's standings batches is the current one.
 *
 * Standings calculated from imported matches are the source of truth. A CSV
 * import is the fallback, used only when the season has no calculated batch or
 * the calculation had no matches to work from (a past season imported from a
 * sheet, or an event before its first match). Otherwise the newest batch wins.
 */

export const COMPUTED_SOURCE = 'computed_from_matches'

type BatchLike = { metadata?: Record<string, unknown> | null }

export function isComputedBatch(batch: BatchLike): boolean {
  return batch.metadata?.source === COMPUTED_SOURCE
}

function hasMatches(batch: BatchLike): boolean {
  return Number(batch.metadata?.match_count ?? 0) > 0
}

/** `batches` must be newest first, as every reader already orders them. */
export function pickStandingsBatch<T extends BatchLike>(batches: T[]): T | null {
  return batches.find((b) => isComputedBatch(b) && hasMatches(b)) ?? batches[0] ?? null
}

/** The same preference applied as an ordering, for readers that walk a list. */
export function orderStandingsBatches<T extends BatchLike>(batches: T[]): T[] {
  const preferred = pickStandingsBatch(batches)
  if (!preferred) return batches
  return [preferred, ...batches.filter((b) => b !== preferred)]
}
