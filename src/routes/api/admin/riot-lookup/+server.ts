import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { enforceRateLimit } from '$lib/server/rate-limit'
import { RiotLookupError, lookupSignupRank } from '$lib/server/riot/henrik'
import { linkedPuuidsFor, loadAltAccounts } from '$lib/server/players/riot-accounts'
import { pickSignupAccount } from '$lib/server/signups/rank-account'
import { supabaseAdmin } from '$lib/supabase/admin'

/**
 * Look a player's rank up through HenrikDev.
 *
 * Uses the PUUID linked to `profileId` when there is one, so a renamed player
 * still resolves; `riotId` (name#tag) is the fallback. The player's alts are
 * compared too, and the rank returned is from the account `pickSignupAccount`
 * chose. With `signupId`, that comparison is saved on the signup straight away:
 * it is a record of the check, not an edit for the admin to confirm.
 *
 * Admin-only and rate limited: this calls a third-party service, so it is
 * deliberately not reachable from the public signup form.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const admin = await requireAdmin(locals.user)

  const riotId = url.searchParams.get('riotId')?.trim() || null
  const profileId = url.searchParams.get('profileId')?.trim() || null
  const signupId = url.searchParams.get('signupId')?.trim() || null
  if (!riotId && !profileId) throw error(400, 'riotId or profileId is required')

  enforceRateLimit(`riot:lookup:${admin.id}`, {
    limit: 20,
    windowMs: 60_000,
    message: 'Too many lookups. Wait a moment before trying again.',
  })

  try {
    const puuid = profileId ? ((await linkedPuuidsFor([profileId])).get(profileId) ?? null) : null
    const alts = profileId ? ((await loadAltAccounts([profileId])).get(profileId) ?? []) : []
    const { lookup, check } = await pickSignupAccount({ puuid, riotId }, alts, lookupSignupRank)
    const { account, rank } = lookup

    if (signupId && check) {
      const { error: saveError } = await supabaseAdmin
        .from('player_signups')
        .update({ alt_check: check })
        .eq('id', signupId)
      if (saveError) console.error('Failed to save signup alt check:', saveError)
    }

    return json({
      altCheck: check,
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
