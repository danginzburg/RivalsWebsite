import { error, type RequestHandler } from '@sveltejs/kit'
import { dev } from '$app/environment'
import { CACHE_FINAL, CACHE_HOURS, cardResponse } from '$lib/server/og/kit'
import { buildPickemFinalCard, loadPickemFinal } from '$lib/server/og/pickem-card'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A pick'em's final standings: the image on the Discord "Final" announcement.
 * A scored pick'em is settled, so the CDN keeps it for a day; the post's `?v=`
 * changes if the scores are corrected.
 */
export const GET: RequestHandler = async ({ params, url }) => {
  const id = params.eventId ?? ''
  if (!UUID_RE.test(id)) throw error(404, 'Pick’em not found')
  const card = await loadPickemFinal(id)
  if (!card) throw error(404, 'Pick’em not found')

  // Dev-only: ?svg shows satori's layout before rasterising, for tweaking the design.
  return cardResponse(
    buildPickemFinalCard(card),
    card.status === 'scored' ? CACHE_FINAL : CACHE_HOURS,
    { svg: dev && url.searchParams.has('svg') }
  )
}
