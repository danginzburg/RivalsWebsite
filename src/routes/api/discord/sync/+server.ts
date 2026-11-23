import { timingSafeEqual } from 'node:crypto'
import { error, json, type RequestHandler } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { runDiscordSync } from '$lib/server/discord-events/sync'
import { discordConfig } from '$lib/server/discord-events/api'
import { runThreadSync, type ThreadSyncReport } from '$lib/server/discord-bot/thread-sync'

/**
 * The scheduled run of the Discord sync: match events both ways, plus the
 * match scheduling threads. Supabase pg_cron calls it every minute with
 * `Authorization: Bearer <DISCORD_SYNC_SECRET>` (see docs/discord-bot.md).
 */

function authorized(header: string | null): boolean {
  const secret = env.DISCORD_SYNC_SECRET?.trim()
  if (!secret || !header) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const given = Buffer.from(header.trim())
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/** Scheduling threads: linked by title, vetoes imported. Never throws. */
async function syncThreads(): Promise<ThreadSyncReport> {
  const config = discordConfig()
  if (!config) return { configured: false, linked: 0, vetoes: 0, errors: [] }
  try {
    return await runThreadSync(config)
  } catch (err) {
    return { configured: true, linked: 0, vetoes: 0, errors: [(err as Error).message] }
  }
}

const handler: RequestHandler = async ({ request, url }) => {
  if (!authorized(request.headers.get('authorization'))) throw error(401, 'Unauthorized')
  // The two jobs don't depend on each other, so one failing doesn't stop the other.
  const [events, threads] = await Promise.all([
    runDiscordSync(url.origin).catch((err: Error) => err),
    syncThreads(),
  ])
  if (threads.errors.length > 0) console.error('Discord thread sync errors:', threads.errors)
  if (events instanceof Error) {
    console.error('Discord event sync failed:', events)
    return json({ error: 'Discord event sync failed', threads }, { status: 502 })
  }
  if (events.errors.length > 0) console.error('Discord event sync errors:', events.errors)
  return json({ ...events, threads })
}

export const GET = handler
export const POST = handler
