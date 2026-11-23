import { error, type RequestHandler } from '@sveltejs/kit'
import { dev } from '$app/environment'
import {
  loadMatchCard,
  renderMatchCard,
  renderMatchCardSvg,
  type MatchCardData,
} from '$lib/server/og/match-card'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The match scorecard image used as the link preview for /matches/[id].
 * A finished match's card never changes, so the CDN keeps it for a day; an
 * upcoming one is refreshed every few minutes so a reschedule shows up.
 */
export const GET: RequestHandler = async ({ params, setHeaders, url }) => {
  const id = params.id ?? ''
  if (!UUID_RE.test(id)) throw error(404, 'Match not found')

  const loaded = await loadMatchCard(id)
  if (!loaded) throw error(404, 'Match not found')

  // Dev-only: ?status=scheduled|live|cancelled previews the other designs on a real match.
  const statusOverride = dev ? url.searchParams.get('status') : null
  const card: MatchCardData =
    statusOverride === 'scheduled' || statusOverride === 'live' || statusOverride === 'cancelled'
      ? { ...loaded, status: statusOverride, maps: [], winner: null }
      : loaded

  // Dev-only: ?svg shows satori's layout before rasterising, for tweaking the design.
  if (dev && url.searchParams.has('svg')) {
    return new Response(await renderMatchCardSvg(card), {
      headers: { 'content-type': 'image/svg+xml' },
    })
  }

  const png = await renderMatchCard(card)
  setHeaders({
    'content-type': 'image/png',
    'cache-control':
      card.status === 'completed'
        ? 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'
        : 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
  })
  return new Response(new Uint8Array(png))
}
