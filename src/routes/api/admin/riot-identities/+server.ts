import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import {
  linkRiotIdentity,
  listUnlinkedIdentities,
  RiotIdentityError,
} from '$lib/server/players/riot-identities'

/**
 * Admin review queue for PUUID identities. GET lists the unlinked ones (ranked
 * by how much they have played); POST ties one to a profile, pooling all of its
 * stats in via the existing claim relink.
 */
export const GET: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals.user)
  const identities = await listUnlinkedIdentities()
  return json({ identities })
}

export const POST: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const puuid = typeof body.puuid === 'string' ? body.puuid.trim() : ''
  const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : ''
  if (!puuid) throw error(400, 'A puuid is required.')
  if (!profileId) throw error(400, 'A profileId is required.')

  try {
    const result = await linkRiotIdentity({ puuid, profileId, adminProfileId: admin.id })
    return json({ success: true, ...result })
  } catch (err) {
    if (err instanceof RiotIdentityError) throw error(err.status, err.message)
    throw err
  }
}
