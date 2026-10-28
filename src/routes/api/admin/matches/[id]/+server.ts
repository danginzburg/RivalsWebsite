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
import { refreshStandingsForSeason } from '$lib/server/leaderboard/computed'
import { refreshLiveBatchesForMatch } from '$lib/server/stats/from-matches'
import {
  notifyMatchCancelled,
  notifyMatchResult,
  notifyMatchScheduled,
} from '$lib/server/notifications/events'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseScheduledAt(value: unknown): string | null {
  const raw = normalizeOptional(value)
  if (!raw) return null

  // The client sends an absolute UTC ISO string (converted from the viewer's
  // local wall-clock time in the browser). Do NOT accept a bare datetime-local
  // string here — new Date() would reinterpret it in the server's zone (UTC).
  const d = new Date(raw)
  if (!Number.isFinite(d.getTime())) throw error(400, 'Invalid scheduledAt')
  return d.toISOString()
}

async function loadMatchSeasonId(matchId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('matches')
    .select('season_id')
    .eq('id', matchId)
    .maybeSingle()
  return (data?.season_id as string | null | undefined) ?? null
}

/**
 * Standings and live stat batches follow every result edit. An update can
 * re-file the match into another season or stage, so the season it left is
 * recalculated too, and batches it moves into or out of are rebuilt.
 */
async function refreshStandingsAfterEdit(
  matchId: string,
  previousSeasonId: string | null,
  adminProfileId: string
) {
  const currentSeasonId = await loadMatchSeasonId(matchId)
  await refreshStandingsForSeason(currentSeasonId, adminProfileId)
  if (previousSeasonId && previousSeasonId !== currentSeasonId) {
    await refreshStandingsForSeason(previousSeasonId, adminProfileId)
  }
  await refreshLiveBatchesForMatch({ matchId, adminProfileId })
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

  const previousSeasonId = await loadMatchSeasonId(matchId)

  try {
    if (action === 'cancel') {
      const updated = await cancelMatch({ matchId, adminProfileId: admin.id })
      await refreshStandingsAfterEdit(matchId, previousSeasonId, admin.id)
      await notifyMatchCancelled(matchId, admin.id)
      return json({ success: true, match: updated })
    }

    if (action === 'update') {
      const { data: before } = await supabaseAdmin
        .from('matches')
        .select('scheduled_at, status')
        .eq('id', matchId)
        .maybeSingle()
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
        outOfGroup: typeof body.outOfGroup === 'boolean' ? body.outOfGroup : undefined,
        // Absent leaves the season alone; present re-files the match.
        seasonId:
          body.seasonId === undefined ? undefined : await resolveTargetSeasonId(body.seasonId),
      })
      await refreshStandingsAfterEdit(matchId, previousSeasonId, admin.id)

      // Rosters hear about a new or moved start time, and about a result the
      // edit itself completed; ordinary detail edits stay quiet.
      const after = updated as { scheduled_at?: string | null; status?: string | null }
      const scheduleChanged =
        Boolean(after.scheduled_at) &&
        new Date(after.scheduled_at ?? '').getTime() !==
          new Date(before?.scheduled_at ?? '').getTime()
      if (after.status === 'completed' && before?.status !== 'completed') {
        await notifyMatchResult(matchId, admin.id)
      } else if (after.status === 'cancelled' && before?.status !== 'cancelled') {
        await notifyMatchCancelled(matchId, admin.id)
      } else if (scheduleChanged && after.status !== 'completed') {
        await notifyMatchScheduled(matchId, admin.id)
      }
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
      await refreshStandingsAfterEdit(matchId, previousSeasonId, admin.id)
      await notifyMatchResult(matchId, admin.id)
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

    await refreshStandingsAfterEdit(matchId, previousSeasonId, admin.id)
    return json({ success: true })
  }

  throw error(400, 'Unsupported action')
}

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const admin = await requireAdmin(locals.user)

  const matchId = params.id
  const seasonId = matchId ? await loadMatchSeasonId(matchId) : null
  const { error: deleteError } = await supabaseAdmin.from('matches').delete().eq('id', matchId)
  if (deleteError) throw error(500, 'Failed to delete match')

  await refreshStandingsForSeason(seasonId, admin.id)
  // The match row is gone, so this rebuilds the batches that held it.
  if (matchId) await refreshLiveBatchesForMatch({ matchId, adminProfileId: admin.id })

  return json({ success: true })
}
