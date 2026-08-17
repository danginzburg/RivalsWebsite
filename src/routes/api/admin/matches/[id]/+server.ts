import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import {
  MatchLifecycleError,
  cancelMatch,
  finalizeMatch,
  updateMatchDetails,
} from '$lib/server/matches/lifecycle'
import { supabaseAdmin } from '$lib/supabase/admin'
import { logAdminAction } from '$lib/server/audit/admin-actions'
import { resolveTargetSeasonId } from '$lib/server/seasons/resolve'
import { normalizeSectionKey } from '$lib/stats/sections'

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
        designation: normalizeOptional(body.designation),
        // Unknown values are dropped rather than rejected — the column feeds
        // the batch generator, and a typo should leave the match unfiled, not
        // fail the whole edit.
        stage: normalizeSectionKey(body.stage),
        // Absent leaves the season alone; present re-files the match.
        seasonId:
          body.seasonId === undefined ? undefined : await resolveTargetSeasonId(body.seasonId),
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

  if (action === 'toggle_map_voided') {
    const mapId = normalizeOptional(body.mapId)
    const isVoided = Boolean(body.isVoided)

    if (!mapId) throw error(400, 'Missing mapId')

    const { data: map, error: mapError } = await supabaseAdmin
      .from('match_maps')
      .select('id, map_order, map_name')
      .eq('id', mapId)
      .eq('match_id', matchId)
      .maybeSingle()

    if (mapError || !map) throw error(404, 'Map not found for this match')

    const { error: updateError } = await supabaseAdmin
      .from('match_maps')
      .update({ is_voided: isVoided })
      .eq('id', mapId)

    if (updateError) throw error(500, 'Failed to update map voided status')

    await logAdminAction({
      adminProfileId: admin.id,
      actionType: 'match_map_voided_toggled',
      targetTable: 'match_maps',
      targetId: mapId,
      details: {
        matchId,
        mapOrder: map.map_order,
        mapName: map.map_name,
        isVoided,
      },
    })

    return json({ success: true })
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
