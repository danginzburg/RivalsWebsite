import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { savePickemForSeason, scorePickemSubmissionsForEvent } from '$lib/server/pickems'
import { invalidateSeasonSeeds } from '$lib/server/seasons/seeds'

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  await requireAdmin(locals.user)
  if (!params.seasonId) throw error(400, 'Season id is required')
  const body = await request.json().catch(() => ({}))
  const context = await savePickemForSeason(params.seasonId, body)
  // Seeds are read from this config across the site, so drop the cached copy.
  invalidateSeasonSeeds(params.seasonId)
  return json({ success: true, context })
}

export const POST: RequestHandler = async ({ locals, params }) => {
  await requireAdmin(locals.user)
  if (!params.seasonId) throw error(400, 'Season id is required')
  const summary = await scorePickemSubmissionsForEvent(params.seasonId)
  return json({ success: true, summary })
}
