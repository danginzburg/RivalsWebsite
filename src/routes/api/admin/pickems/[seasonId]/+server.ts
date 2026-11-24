import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { publicDataCache } from '$lib/server/cache'
import { normalizePickemFormat } from '$lib/pickems'
import { savePickemForSeason } from '$lib/server/pickems'
import { invalidateSeasonSeeds } from '$lib/server/seasons/seeds'
import { supabaseAdmin } from '$lib/supabase/admin'
import { notifyPickemOpened, notifyPickemScored } from '$lib/server/notifications/events'
import { syncSeasonAccoladesSafely } from '$lib/server/accolades/season-sync'
import {
  inBackground,
  postPickemLocked,
  postPickemOpened,
  postPickemWinnerIfSettled,
} from '$lib/server/discord/announce'

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  await requireAdmin(locals.user)
  if (!params.seasonId) throw error(400, 'Season id is required')
  const body = await request.json().catch(() => ({}))
  // A season can hold a bracket and a weekly pick'em; compare against the one being saved.
  const format = normalizePickemFormat((body as Record<string, unknown>).format)
  const { data: before } = await supabaseAdmin
    .from('pickem_events')
    .select('status')
    .eq('season_id', params.seasonId)
    .eq('format', format)
    .maybeSingle()
  const context = await savePickemForSeason(params.seasonId, body)
  // Seeds are read from this config across the site, so drop the cached copy.
  invalidateSeasonSeeds(params.seasonId)
  // The leaderboard draws this bracket and its seeds.
  publicDataCache.delete('leaderboard:standings')

  // Announce the transitions players care about: picks opening, and scores landing.
  const status = context.event?.status
  if (context.event && status !== before?.status) {
    const event = context.event
    if (status === 'open' && before?.status !== 'locked' && before?.status !== 'scored') {
      await notifyPickemOpened(context.season, event.lockAt)
      inBackground('pickem opened', () => postPickemOpened(context.season, event))
    } else if (status === 'locked') {
      inBackground('pickem locked', () => postPickemLocked(context.season, event))
    } else if (status === 'scored') {
      await notifyPickemScored(context.season, context.event.id)
    }
  }
  // Resolved results can settle the pick'em, and with it its champion accolade.
  await syncSeasonAccoladesSafely({ seasonIds: [params.seasonId] })
  // An admin resolving the last bracket slot here can settle the pick'em winner too.
  const seasonId = params.seasonId
  inBackground('pickem winner', () => postPickemWinnerIfSettled(seasonId))
  return json({ success: true, context })
}
