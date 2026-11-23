import { error, type RequestHandler } from '@sveltejs/kit'
import { dev } from '$app/environment'
import { buildEventCard, loadEventCard } from '$lib/server/og/event-card'
import { CACHE_FINAL, CACHE_HOURS, cardResponse } from '$lib/server/og/kit'

/**
 * The preview card for /events/[seasonCode]. A finished event's podium is
 * final, so the CDN keeps it for a day; a running one refreshes every few hours.
 */
export const GET: RequestHandler = async ({ params, url }) => {
  const card = await loadEventCard(params.seasonCode ?? '')
  if (!card) throw error(404, 'Season not found')

  // Dev-only: ?svg shows satori's layout before rasterising, for tweaking the design.
  return cardResponse(await buildEventCard(card), card.champion ? CACHE_FINAL : CACHE_HOURS, {
    svg: dev && url.searchParams.has('svg'),
  })
}
