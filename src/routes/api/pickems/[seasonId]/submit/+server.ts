import { error, json, type RequestHandler } from '@sveltejs/kit'

import { assertCanParticipate, requireProfile } from '$lib/server/auth/profile'
import { upsertPlayoffPickemSubmission } from '$lib/server/playoffPickems'

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const profile = await requireProfile(locals.user)
  assertCanParticipate(profile)
  if (!params.seasonId) throw error(400, 'Season id is required')

  const payload = await request.json().catch(() => ({}))
  const submission = await upsertPlayoffPickemSubmission({
    seasonId: params.seasonId,
    profileId: profile.id,
    payload,
  })

  return json({ success: true, submission })
}
