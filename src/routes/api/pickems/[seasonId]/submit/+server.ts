import { error, json, type RequestHandler } from '@sveltejs/kit'

import { assertCanParticipate, requireProfile } from '$lib/server/auth/profile'
import { upsertPickemSubmission } from '$lib/server/pickems'

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const profile = await requireProfile(locals.user)
  assertCanParticipate(profile)
  if (!params.seasonId) throw error(400, 'Season id is required')

  const payload = await request.json().catch(() => ({}))
  // `format` picks which of the season's pick'ems (bracket or weekly) the picks are for.
  const format =
    payload && typeof payload === 'object' ? (payload as Record<string, unknown>).format : undefined
  const submission = await upsertPickemSubmission({
    seasonId: params.seasonId,
    profileId: profile.id,
    format,
    payload,
  })

  return json({ success: true, submission })
}
