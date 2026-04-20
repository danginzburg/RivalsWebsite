import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { scoreAllPickemSubmissionsForSeason } from '$lib/server/pickems'

export const POST: RequestHandler = async ({ locals, params }) => {
  await requireAdmin(locals.user)

  const seasonId = params.seasonId?.trim()
  if (!seasonId) throw error(400, 'Season id is required')

  const summary = await scoreAllPickemSubmissionsForSeason(seasonId)
  return json({ success: true, ...summary })
}
