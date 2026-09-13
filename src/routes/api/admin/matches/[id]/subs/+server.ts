import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { loadMatchSubOverrides, setMatchSubOverride } from '$lib/server/matches/subs'

/**
 * Admin per-match sub override: force one source account to count as a sub or a
 * starter, overriding the roster-derived default. Stored by match, so it
 * survives a re-import.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
  await requireAdmin(locals.user)
  const matchId = params.id
  if (!matchId) throw error(400, 'Match id is required')
  return json({ overrides: await loadMatchSubOverrides(matchId) })
}

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const admin = await requireAdmin(locals.user)
  const matchId = params.id
  if (!matchId) throw error(400, 'Match id is required')

  const body = await request.json().catch(() => ({}))
  const puuid = typeof body.puuid === 'string' && body.puuid.trim() ? body.puuid.trim() : null
  const playerName =
    typeof body.playerName === 'string' && body.playerName.trim() ? body.playerName.trim() : null
  // isSub: true = force sub, false = force starter, null = clear the override.
  const isSub = body.isSub === null ? null : Boolean(body.isSub)
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null

  if (!puuid && !playerName) {
    throw error(400, 'A puuid or playerName is required to identify the player')
  }

  await setMatchSubOverride({
    matchId,
    puuid,
    playerName,
    isSub,
    note,
    createdByProfileId: admin.id,
  })

  return json({ success: true })
}
