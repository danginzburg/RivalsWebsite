import type { PageServerLoad } from './$types'
import { parseCompareIds, parseCompareKind } from '$lib/compare'
import { loadComparison } from '$lib/server/compare/load'

export type { CompareEntity, StatsRow } from '$lib/server/compare/load'

export const load: PageServerLoad = async ({ url, fetch }) => {
  // The card data only feeds the og:image; the page renders from the rest.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { card, ...data } = await loadComparison({
    kind: parseCompareKind(url.searchParams.get('type')),
    requestedIds: parseCompareIds(url.searchParams.get('ids')),
    requestedBatch: url.searchParams.get('batchId'),
    fetch,
  })
  return data
}
