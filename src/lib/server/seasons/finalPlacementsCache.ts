import { TtlCache } from '$lib/server/cache'
import type { SeasonFinalPlacements } from '$lib/server/seasons/finalPlacements'

/**
 * Kept apart from the calculation so the standings code can clear it after an
 * import without importing the calculation (which reads standings itself).
 */
export const finalPlacementsCache = new TtlCache<SeasonFinalPlacements>({
  ttlMs: 10 * 60_000,
  maxEntries: 50,
})

/** Drop every season's cached finishes: results or standings changed. */
export function invalidateFinalPlacements() {
  finalPlacementsCache.clear()
}
