import { error, type RequestHandler } from '@sveltejs/kit'
import { dev } from '$app/environment'
import { parseCompareIds, parseCompareKind } from '$lib/compare'
import { loadComparison } from '$lib/server/compare/load'
import { buildCompareCard } from '$lib/server/og/compare-card'
import { CACHE_FINAL, CACHE_HOURS, cardResponse } from '$lib/server/og/kit'

/**
 * The preview card for /compare, from the same query string (`type`, `ids`,
 * `batchId`). A comparison inside a finished season is final and stays on the
 * CDN for a day; anything else refreshes every few hours.
 */
export const GET: RequestHandler = async ({ url, fetch }) => {
  const { card } = await loadComparison({
    kind: parseCompareKind(url.searchParams.get('type')),
    requestedIds: parseCompareIds(url.searchParams.get('ids')),
    requestedBatch: url.searchParams.get('batchId'),
    fetch,
    details: false,
  })
  if (!card) throw error(404, 'Pick at least two to compare')

  // Dev-only: ?svg shows satori's layout before rasterising, for tweaking the design.
  return cardResponse(await buildCompareCard(card), card.finished ? CACHE_FINAL : CACHE_HOURS, {
    svg: dev && url.searchParams.has('svg'),
  })
}
