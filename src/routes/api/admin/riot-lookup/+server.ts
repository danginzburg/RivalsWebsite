import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { enforceRateLimit } from '$lib/server/rate-limit'
import { RiotLookupError, lookupPlayer } from '$lib/server/riot/henrik'

/**
 * Look a player up against the Riot account and MMR APIs.
 *
 * Admin-only and rate limited: this calls a third-party service, so it is
 * deliberately not reachable from the public signup form.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const admin = await requireAdmin(locals.user)

  const riotId = url.searchParams.get('riotId')?.trim()
  if (!riotId) throw error(400, 'riotId is required')

  enforceRateLimit(`riot:lookup:${admin.id}`, {
    limit: 20,
    windowMs: 60_000,
    message: 'Too many lookups. Wait a moment before trying again.',
  })

  try {
    const { account, rank } = await lookupPlayer(riotId)
    return json({
      success: true,
      account: {
        puuid: account.puuid,
        name: account.name,
        tag: account.tag,
        region: account.region,
        accountLevel: account.accountLevel,
      },
      rank: rank && {
        currentTier: rank.currentTier,
        currentRank: rank.currentRank,
        currentRr: rank.currentRr,
        peakTier: rank.peakTier,
        peakRank: rank.peakRank,
        peakSeason: rank.peakSeason,
      },
    })
  } catch (err) {
    if (err instanceof RiotLookupError) throw error(err.status, err.message)
    throw err
  }
}
