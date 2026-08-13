import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import {
  savePlayoffPickemConfigForSeason,
  scorePlayoffPickemSubmissionsForSeason,
} from '$lib/server/playoffPickems'
import { invalidateSeasonSeeds } from '$lib/server/seasons/seeds'

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  await requireAdmin(locals.user)
  if (!params.seasonId) throw error(400, 'Season id is required')
  const body = await request.json().catch(() => ({}))
  const config = await savePlayoffPickemConfigForSeason(params.seasonId, body.config ?? body)
  // Seeds are read from this config across the site, so drop the cached copy.
  invalidateSeasonSeeds(params.seasonId)
  return json({ success: true, config })
}

export const POST: RequestHandler = async ({ locals, params }) => {
  await requireAdmin(locals.user)
  if (!params.seasonId) throw error(400, 'Season id is required')
  const summary = await scorePlayoffPickemSubmissionsForSeason(params.seasonId)
  return json({ success: true, summary })
}
