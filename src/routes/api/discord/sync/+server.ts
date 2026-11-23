import { timingSafeEqual } from 'node:crypto'
import { error, json, type RequestHandler } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { runDiscordSync } from '$lib/server/discord-events/sync'

/**
 * The scheduled run of the Discord event sync. Supabase pg_cron calls it every
 * minute with `Authorization: Bearer <DISCORD_SYNC_SECRET>` (see
 * docs/discord-bot.md).
 */

function authorized(header: string | null): boolean {
  const secret = env.DISCORD_SYNC_SECRET?.trim()
  if (!secret || !header) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const given = Buffer.from(header.trim())
  return expected.length === given.length && timingSafeEqual(expected, given)
}

const handler: RequestHandler = async ({ request, url }) => {
  if (!authorized(request.headers.get('authorization'))) throw error(401, 'Unauthorized')
  try {
    const report = await runDiscordSync(url.origin)
    if (report.errors.length > 0) console.error('Discord event sync errors:', report.errors)
    return json(report)
  } catch (err) {
    console.error('Discord event sync failed:', err)
    throw error(502, 'Discord event sync failed')
  }
}

export const GET = handler
export const POST = handler
