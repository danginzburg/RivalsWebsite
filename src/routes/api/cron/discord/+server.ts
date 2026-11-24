import { error, json, type RequestHandler } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { supabaseAdmin } from '$lib/supabase/admin'
import { leagueDayEnd } from '$lib/server/discord/embeds'
import { postMatchReminder, postPickemLockWarning } from '$lib/server/discord/announce'

/*
 * The daily Discord run (vercel.json: 10 AM Eastern). Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET`; any other pinger must send it too.
 *   - "Match day" in the scheduling thread of each match still to play today
 *   - "Pick'em locks today" for an open pick'em that locks before midnight
 * "Today" ends at midnight league (Central) time. Every post is deduplicated
 * through discord_posts, so an extra run never posts twice.
 */

export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    throw error(401, 'Unauthorized')
  }

  const nowIso = new Date().toISOString()
  const endOfDay = leagueDayEnd().toISOString()

  const [{ data: matches, error: matchError }, { data: events, error: eventError }] =
    await Promise.all([
      supabaseAdmin
        .from('matches')
        .select('id')
        .eq('status', 'scheduled')
        .gt('scheduled_at', nowIso)
        .lt('scheduled_at', endOfDay),
      supabaseAdmin
        .from('pickem_events')
        .select('id, title, lock_at, season:seasons (id, code, name)')
        .eq('status', 'open')
        .gt('lock_at', nowIso)
        .lt('lock_at', endOfDay),
    ])
  if (matchError) console.error('Cron: failed to load today’s matches:', matchError)
  if (eventError) console.error('Cron: failed to load pick’ems:', eventError)

  // Awaited (not backgrounded): the cron call itself is the background work.
  for (const match of matches ?? []) await postMatchReminder(match.id as string)

  type SeasonRel = { id: string; code: string; name: string }
  for (const event of events ?? []) {
    const season = (
      Array.isArray(event.season) ? event.season[0] : event.season
    ) as SeasonRel | null
    if (!season) continue
    await postPickemLockWarning(season, {
      id: event.id as string,
      title: event.title as string,
      lockAt: event.lock_at as string,
    })
  }

  return json({ ok: true, matches: matches?.length ?? 0, pickems: events?.length ?? 0 })
}
