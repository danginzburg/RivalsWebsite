import type { PageServerLoad } from './$types'
import { parseCompareIds, parseCompareKind } from '$lib/compare'
import { loadComparison } from '$lib/server/compare/load'
import { getValorantMapList } from '$lib/server/valorant/maps'

export type { CompareEntity, StatsRow } from '$lib/server/compare/load'

export const load: PageServerLoad = async ({ url, fetch }) => {
  const kind = parseCompareKind(url.searchParams.get('type'))
  // Map art only illustrates the team Map pool chart. The list is cached for
  // the server's lifetime; a failed fetch yields [] and the chart shows names.
  const [comparison, maps] = await Promise.all([
    loadComparison({
      kind,
      requestedIds: parseCompareIds(url.searchParams.get('ids')),
      requestedBatch: url.searchParams.get('batchId'),
      fetch,
    }),
    kind === 'teams' ? getValorantMapList() : Promise.resolve([]),
  ])
  // The card data only feeds the og:image; the page renders from the rest.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { card, ...data } = comparison
  const mapArt: Record<string, string> = {}
  for (const map of maps) mapArt[map.displayName.toLowerCase()] = map.listViewIcon
  return { ...data, mapArt }
}
