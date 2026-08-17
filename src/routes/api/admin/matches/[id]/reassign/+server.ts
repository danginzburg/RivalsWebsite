import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import {
  loadMatchStatReassignments,
  removeMatchStatReassignment,
  upsertMatchStatReassignment,
} from '$lib/server/matches/reassignments'

/**
 * Admin per-match stat reassignment: move one source account's rows in this
 * match to a different profile (the "played on someone else's account once"
 * case). Stored by match, so it survives a re-import.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
  await requireAdmin(locals.user)
  const matchId = params.id
  if (!matchId) throw error(400, 'Match id is required')
  return json({ reassignments: await loadMatchStatReassignments(matchId) })
}

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const admin = await requireAdmin(locals.user)
  const matchId = params.id
  if (!matchId) throw error(400, 'Match id is required')

  const body = await request.json().catch(() => ({}))
  const puuid = typeof body.puuid === 'string' && body.puuid.trim() ? body.puuid.trim() : null
  const playerName =
    typeof body.playerName === 'string' && body.playerName.trim() ? body.playerName.trim() : null
  const profileId = typeof body.profileId === 'string' ? body.profileId : null
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null

  if (!profileId) throw error(400, 'A target profileId is required')
  if (!puuid && !playerName) {
    throw error(400, 'A puuid or playerName is required to identify the stats')
  }

  await upsertMatchStatReassignment({
    matchId,
    puuid,
    playerName,
    profileId,
    note,
    createdByProfileId: admin.id,
  })

  return json({ success: true })
}

export const DELETE: RequestHandler = async ({ locals, params, url }) => {
  await requireAdmin(locals.user)
  const matchId = params.id
  if (!matchId) throw error(400, 'Match id is required')

  const id = url.searchParams.get('id')
  if (!id) throw error(400, 'Reassignment id is required')

  await removeMatchStatReassignment(matchId, id)
  return json({ success: true })
}
