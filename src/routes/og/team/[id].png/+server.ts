import { error, type RequestHandler } from '@sveltejs/kit'
import { dev } from '$app/environment'
import { CACHE_HOURS, cardResponse } from '$lib/server/og/kit'
import { buildTeamCard, loadTeamCard } from '$lib/server/og/team-card'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The preview card for /teams/[id]. Records and rosters change through a
 * season, so the CDN refreshes it every few hours; the page's `?v=` makes
 * Discord fetch a new one sooner when something changed.
 */
export const GET: RequestHandler = async ({ params, url }) => {
  const id = params.id ?? ''
  if (!UUID_RE.test(id)) throw error(404, 'Team not found')

  const card = await loadTeamCard(id)
  if (!card) throw error(404, 'Team not found')

  // Dev-only: ?svg shows satori's layout before rasterising, for tweaking the design.
  return cardResponse(await buildTeamCard(card), CACHE_HOURS, {
    svg: dev && url.searchParams.has('svg'),
  })
}
