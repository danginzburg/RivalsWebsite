import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { publicDataCache } from '$lib/server/cache'
import { savePickemForSeason } from '$lib/server/pickems'
import { invalidateSeasonSeeds } from '$lib/server/seasons/seeds'
import { supabaseAdmin } from '$lib/supabase/admin'
import { notifyPickemOpened, notifyPickemScored } from '$lib/server/notifications/events'
import { syncSeasonAccoladesSafely } from '$lib/server/accolades/season-sync'

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  await requireAdmin(locals.user)
  if (!params.seasonId) throw error(400, 'Season id is required')
  const body = await request.json().catch(() => ({}))
  const { data: before } = await supabaseAdmin
    .from('pickem_events')
    .select('status')
    .eq('season_id', params.seasonId)
    .maybeSingle()
  const context = await savePickemForSeason(params.seasonId, body)
  // Seeds are read from this config across the site, so drop the cached copy.
  invalidateSeasonSeeds(params.seasonId)
  // The leaderboard draws this bracket and its seeds.
  publicDataCache.delete('leaderboard:standings')

  // Announce the transitions players care about: picks opening, and scores landing.
  const status = context.event?.status
  if (context.event && status !== before?.status) {
    if (status === 'open' && before?.status !== 'locked' && before?.status !== 'scored') {
      await notifyPickemOpened(context.season, context.event.lockAt)
    } else if (status === 'scored') {
      await notifyPickemScored(context.season, context.event.id)
    }
  }
  // Resolved results can settle the pick'em, and with it its champion accolade.
  await syncSeasonAccoladesSafely({ seasonIds: [params.seasonId] })
  return json({ success: true, context })
}
