import { error, json, type RequestHandler } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { supabaseAdmin } from '$lib/supabase/admin'
import {
  postMatchReminder,
  postPickemLockWarning,
  postPickemLocked,
} from '$lib/server/discord/announce'

/*
 * Timed Discord posts, run every ~15 minutes by a cron (Vercel Cron, or any
 * pinger that sends `Authorization: Bearer $CRON_SECRET`):
 *   - "starts in 1 hour" in the match's scheduling thread
 *   - "pick'em locks soon" an hour before lock, and "locked" once it has
 * Every post is deduplicated through discord_posts, so overlapping or repeated
 * runs never post twice.
 */

const HOUR_MS = 60 * 60 * 1000
/** A lock this long ago still gets its "locked" post, in case a run was missed. */
const LOCKED_GRACE_MS = 6 * HOUR_MS

export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    throw error(401, 'Unauthorized')
  }

  const now = Date.now()
  const soon = new Date(now + HOUR_MS).toISOString()
  const nowIso = new Date(now).toISOString()

  const [{ data: matches, error: matchError }, { data: events, error: eventError }] =
    await Promise.all([
      supabaseAdmin
        .from('matches')
        .select('id')
        .eq('status', 'scheduled')
        .gt('scheduled_at', nowIso)
        .lte('scheduled_at', soon),
      supabaseAdmin
        .from('pickem_events')
        .select('id, title, status, lock_at, season:seasons (id, code, name)')
        .eq('status', 'open')
        .not('lock_at', 'is', null)
        .gte('lock_at', new Date(now - LOCKED_GRACE_MS).toISOString())
        .lte('lock_at', soon),
    ])
  if (matchError) console.error('Cron: failed to load upcoming matches:', matchError)
  if (eventError) console.error('Cron: failed to load pick’ems:', eventError)

  // Awaited (not backgrounded): the cron call itself is the background work.
  for (const match of matches ?? []) await postMatchReminder(match.id as string)

  type SeasonRel = { id: string; code: string; name: string }
  for (const event of events ?? []) {
    const season = (
      Array.isArray(event.season) ? event.season[0] : event.season
    ) as SeasonRel | null
    if (!season) continue
    const lockAt = event.lock_at as string
    const ref = { id: event.id as string, title: event.title as string, lockAt }
    if (new Date(lockAt).getTime() > now) await postPickemLockWarning(season, ref)
    else await postPickemLocked(season, ref)
  }

  return json({ ok: true, reminders: matches?.length ?? 0, pickems: events?.length ?? 0 })
}
