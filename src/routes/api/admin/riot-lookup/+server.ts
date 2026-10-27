import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { enforceRateLimit } from '$lib/server/rate-limit'
import { RiotLookupError, lookupSignupRank } from '$lib/server/riot/henrik'
import { linkedPuuidsFor } from '$lib/server/players/riot-accounts'

/**
 * Look a player's rank up through HenrikDev.
 *
 * Uses the PUUID linked to `profileId` when there is one, so a renamed player
 * still resolves; `riotId` (name#tag) is the fallback.
 *
 * Admin-only and rate limited: this calls a third-party service, so it is
 * deliberately not reachable from the public signup form.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const admin = await requireAdmin(locals.user)

  const riotId = url.searchParams.get('riotId')?.trim() || null
  const profileId = url.searchParams.get('profileId')?.trim() || null
  if (!riotId && !profileId) throw error(400, 'riotId or profileId is required')

  enforceRateLimit(`riot:lookup:${admin.id}`, {
    limit: 20,
    windowMs: 60_000,
    message: 'Too many lookups. Wait a moment before trying again.',
  })

  try {
    const puuid = profileId ? ((await linkedPuuidsFor([profileId])).get(profileId) ?? null) : null
    const { account, rank } = await lookupSignupRank({ puuid, riotId })
    return json({
      success: true,
      account: {
        puuid: account.puuid,
        name: account.name,
        tag: account.tag,
      },
      /** Whether the stored PUUID was used rather than the name#tag. */
      byPuuid: puuid != null,
      rank: rank && {
        currentTier: rank.currentTier,
        currentRank: rank.currentRank,
        currentRr: rank.currentRr,
        currentSource: rank.currentSource,
        currentAct: rank.currentAct,
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
