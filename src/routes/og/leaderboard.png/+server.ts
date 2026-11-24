import type { RequestHandler } from '@sveltejs/kit'
import { dev } from '$app/environment'
import { loadCurrentStandings, loadStandings } from '$lib/server/leaderboard/standings'
import { CACHE_HOURS, cardResponse } from '$lib/server/og/kit'
import { buildLeaderboardCard, leaderboardCardData } from '$lib/server/og/leaderboard-card'

/**
 * The preview card for /leaderboard: the running season's top eight. The CDN
 * refreshes it every few hours; the page's `?v=` changes with the table.
 */
export const GET: RequestHandler = async ({ url }) => {
  // Dev-only: ?season=<code> draws another season's table, to check the design between seasons.
  const seasonCode = dev ? url.searchParams.get('season') : null
  const standings = seasonCode ? await loadStandings(seasonCode) : await loadCurrentStandings()

  // Dev-only: ?svg shows satori's layout before rasterising, for tweaking the design.
  return cardResponse(await buildLeaderboardCard(leaderboardCardData(standings)), CACHE_HOURS, {
    svg: dev && url.searchParams.has('svg'),
  })
}
