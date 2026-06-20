import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import {
  MatchLifecycleError,
  cancelMatch,
  finalizeMatch,
  updateMatchDetails,
} from '$lib/server/matches/lifecycle'
import { supabaseAdmin } from '$lib/supabase/admin'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseScheduledAt(value: unknown): string | null {
  const raw = normalizeOptional(value)
  if (!raw) return null

  // <input type="datetime-local"> is interpreted in the viewer's local timezone.
  const d = new Date(raw)
  if (!Number.isFinite(d.getTime())) throw error(400, 'Invalid scheduledAt')
  return d.toISOString()
}

function parseMapVetoes(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  const admin = await requireAdmin(locals.user)
  const matchId = params.id
  if (!matchId) throw error(400, 'Missing match id')
  const body = await request.json()

  const action = normalizeOptional(body.action)
  if (!action) throw error(400, 'Missing action')

  try {
    if (action === 'cancel') {
      const updated = await cancelMatch({ matchId, adminProfileId: admin.id })
      return json({ success: true, match: updated })
    }

    if (action === 'update') {
      const updated = await updateMatchDetails({
        matchId,
        adminProfileId: admin.id,
        teamAId: normalizeOptional(body.teamAId),
        teamBId: normalizeOptional(body.teamBId),
        bestOf: Number(body.bestOf ?? 3),
        status: normalizeOptional(body.status),
        scheduledAt: parseScheduledAt(body.scheduledAt),
        teamAScore: Number(body.teamAScore ?? 0),
        teamBScore: Number(body.teamBScore ?? 0),
        winnerTeamId: normalizeOptional(body.winnerTeamId),
        youtubeVodUrl: normalizeOptional(body.youtubeVodUrl),
        mapVetoes: parseMapVetoes(body.mapVetoes),
      })
      return json({ success: true, match: updated })
    }

    if (action === 'finalize') {
      const updated = await finalizeMatch({
        matchId,
        adminProfileId: admin.id,
        teamAScore: Number(body.teamAScore),
        teamBScore: Number(body.teamBScore),
        winnerTeamId: normalizeOptional(body.winnerTeamId),
      })
      return json({ success: true, match: updated })
    }
  } catch (err) {
    if (err instanceof MatchLifecycleError) throw error(err.status, err.message)
    throw err
  }

  throw error(400, 'Unsupported action')
}

export const DELETE: RequestHandler = async ({ locals, params }) => {
  await requireAdmin(locals.user)

  const matchId = params.id
  const { error: deleteError } = await supabaseAdmin.from('matches').delete().eq('id', matchId)
  if (deleteError) throw error(500, 'Failed to delete match')

  return json({ success: true })
}
