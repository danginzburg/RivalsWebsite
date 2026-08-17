import { error, json, type RequestHandler } from '@sveltejs/kit'

import { assertCanParticipate, requireProfile } from '$lib/server/auth/profile'
import { upsertPickemSubmission } from '$lib/server/pickems'

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const profile = await requireProfile(locals.user)
  assertCanParticipate(profile)
  if (!params.seasonId) throw error(400, 'Season id is required')

  const payload = await request.json().catch(() => ({}))
  const submission = await upsertPickemSubmission({
    seasonId: params.seasonId,
    profileId: profile.id,
    payload,
  })

  return json({ success: true, submission })
}
