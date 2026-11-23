import { json, type RequestHandler } from '@sveltejs/kit'
import { loadSearchIndex } from '$lib/server/search'

/**
 * The whole quick-search index: every player and approved team, a few hundred
 * small rows. The header fetches it once on first open and filters locally,
 * so typing never waits on the network. Public data only, so the CDN may
 * serve it to everyone.
 */
export const GET: RequestHandler = async ({ setHeaders }) => {
  const index = await loadSearchIndex()
  setHeaders({ 'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' })
  return json(index)
}
