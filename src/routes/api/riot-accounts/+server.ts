import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireProfile } from '$lib/server/auth/profile'
import { enforceRateLimit } from '$lib/server/rate-limit'
import { normalizeRiotBase, isValidRiotBase, normalizeRiotTag } from '$lib/server/riot-id'
import {
  addAltRiotAccount,
  listRiotAccounts,
  removeAltRiotAccount,
  RiotAccountError,
} from '$lib/server/players/riot-accounts'

/**
 * Self-serve alternate Riot accounts. A player links extra Riot IDs (alts,
 * subs) to their own profile; each is verified against Riot and sits pending
 * until an admin approves it, at which point its stats pool into the profile.
 */
export const GET: RequestHandler = async ({ locals }) => {
  const profile = await requireProfile(locals.user)
  return json({ accounts: await listRiotAccounts(profile.id) })
}

export const POST: RequestHandler = async ({ locals, request }) => {
  const profile = await requireProfile(locals.user)
  const body = await request.json().catch(() => ({}))

  const riotName = normalizeRiotBase(body.riotId)
  const riotTag = normalizeRiotTag(body.riotTag)
  if (!isValidRiotBase(riotName)) {
    throw error(400, 'Enter a valid Riot ID name (3–24 characters, no #tag).')
  }
  if (!riotTag) {
    throw error(400, 'Enter the tagline — the part after the # (3–5 characters).')
  }

  // A Riot lookup runs per add, so cap how fast a player can try new ones.
  enforceRateLimit(`riot-accounts:add:${profile.id}`, {
    limit: 10,
    windowMs: 10 * 60_000,
    message: 'Too many account additions. Wait a few minutes before trying more.',
  })

  const label =
    typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 40) : null

  try {
    const account = await addAltRiotAccount({ profileId: profile.id, riotName, riotTag, label })
    return json({ success: true, account })
  } catch (err) {
    if (err instanceof RiotAccountError) throw error(err.status, err.message)
    throw err
  }
}

export const DELETE: RequestHandler = async ({ locals, url }) => {
  const profile = await requireProfile(locals.user)
  const id = url.searchParams.get('id')
  if (!id) throw error(400, 'Account id is required')

  await removeAltRiotAccount(id, profile.id)
  return json({ success: true })
}
