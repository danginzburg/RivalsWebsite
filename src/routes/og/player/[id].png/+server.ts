import { error, type RequestHandler } from '@sveltejs/kit'
import { dev } from '$app/environment'
import { CACHE_HOURS, cardResponse } from '$lib/server/og/kit'
import { buildPlayerCard, loadPlayerCard } from '$lib/server/og/player-card'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The preview card for /players/[id] (and `?batchId=` for a picked stats
 * table). Stats move with every import, so the CDN refreshes it every few hours;
 * the page's `?v=` makes Discord fetch a new one sooner when something changed.
 */
export const GET: RequestHandler = async ({ params, url }) => {
  const id = params.id ?? ''
  if (!UUID_RE.test(id)) throw error(404, 'Player not found')

  const card = await loadPlayerCard(id, url.searchParams.get('batchId'))
  if (!card) throw error(404, 'Player not found')

  // Dev-only: ?svg shows satori's layout before rasterising, for tweaking the design.
  return cardResponse(await buildPlayerCard(card), CACHE_HOURS, {
    svg: dev && url.searchParams.has('svg'),
  })
}
