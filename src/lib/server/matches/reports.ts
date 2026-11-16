/**
 * Captain result submissions: who may submit, what makes one safe to apply on
 * its own, and the apply step an admin's approval reuses.
 *
 * The rule: a submission that is only tracker links, whose every map's lobby
 * resolves to this match's two teams and whose maps finish the best-of, imports
 * straight away. Anything else — a forfeited map, a note for admins, rosters
 * that don't line up, a score that doesn't add up, a match that already has
 * stats — is held for an admin.
 */
import { error } from '@sveltejs/kit'

import { supabaseAdmin } from '$lib/supabase/admin'
import { isCaptainLike } from '$lib/server/teams/membership'
import { notifyMatchResult } from '$lib/server/notifications/events'
import { checkSeriesScore, seriesScore } from '$lib/matches/report-checks'
import { normalizeVetoLines } from '$lib/matches/vetoLog'
import type { MatchRegion } from '$lib/server/riot/match'
import {
  commitRiotSeries,
  parseSeriesInput,
  prepareRiotSeries,
  type ForfeitMapSpec,
  type PreparedSeries,
  type SeriesPreview,
} from '$lib/server/matches/riot-series'

export type ReportableMatch = {
  id: string
  status: string | null
  approval_status: string | null
  team_a_id: string | null
  team_b_id: string | null
  season_id: string | null
  stage: string | null
  best_of: number | null
  scheduled_at: string | null
  team_a_score: number | null
  team_b_score: number | null
  metadata: Record<string, unknown> | null
}

const REPORTABLE_MATCH_SELECT =
  'id, status, approval_status, team_a_id, team_b_id, season_id, stage, best_of, scheduled_at, team_a_score, team_b_score, metadata'

export async function loadReportableMatch(matchId: string): Promise<ReportableMatch> {
  const { data, error: matchError } = await supabaseAdmin
    .from('matches')
    .select(REPORTABLE_MATCH_SELECT)
    .eq('id', matchId)
    .maybeSingle()
  if (matchError) throw error(500, 'Failed to load the match')
  if (!data || data.approval_status !== 'approved') throw error(404, 'Match not found')
  return data as ReportableMatch
}

/**
 * Over, or at least started: a completed or live match, or one whose scheduled
 * time has passed. Captains report right after playing, often before anyone
 * has flipped the status.
 */
export function isMatchConcluded(match: Pick<ReportableMatch, 'status' | 'scheduled_at'>) {
  if (match.status === 'cancelled') return false
  if (match.status === 'completed' || match.status === 'live') return true
  const at = match.scheduled_at ? Date.parse(match.scheduled_at) : NaN
  return Number.isFinite(at) && at <= Date.now()
}

/**
 * The team in this match the profile captains (or manages), or null. Team ids
 * are per season, so a membership on one of these two ids is already scoped to
 * the match's season — an old captaincy on last season's team doesn't count.
 */
export async function captainTeamForMatch(
  profileId: string,
  match: Pick<ReportableMatch, 'team_a_id' | 'team_b_id'>
): Promise<string | null> {
  const teamIds = [match.team_a_id, match.team_b_id].filter((id): id is string => Boolean(id))
  if (teamIds.length < 2) return null

  const { data, error: membershipError } = await supabaseAdmin
    .from('team_memberships')
    .select('team_id, role')
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .is('left_at', null)
    .in('team_id', teamIds)
  if (membershipError) throw error(500, 'Failed to check team membership')

  const row = (data ?? []).find((m) => isCaptainLike(m.role as string | null))
  return row ? String(row.team_id) : null
}

export async function matchHasStats(matchId: string) {
  const { count, error: statsError } = await supabaseAdmin
    .from('player_match_map_stats')
    .select('match_map_id', { count: 'exact', head: true })
    .eq('match_id', matchId)
  if (statsError) throw error(500, 'Failed to check match stats')
  return (count ?? 0) > 0
}

/**
 * Riot match ids from this submission already imported onto a *different*
 * match — the same lobby can't be two series. Riot imports name their maps
 * `riot-<match id>-map-<n>.json`, which is what this reads.
 */
async function idsImportedElsewhere(ids: string[], matchId: string) {
  if (ids.length === 0) return []
  const { data, error: mapsError } = await supabaseAdmin
    .from('match_maps')
    .select('match_id, source_filename')
    .neq('match_id', matchId)
    // PostgREST takes `*` as the LIKE wildcard inside a filter string.
    .or(ids.map((id) => `source_filename.like.riot-${id}-*`).join(','))
  if (mapsError) throw error(500, 'Failed to check for already-imported maps')
  return ids.filter((id) =>
    (data ?? []).some((row) => String(row.source_filename ?? '').startsWith(`riot-${id}-`))
  )
}

/** Save the veto log onto the match. Display-only, so it never waits for review. */
export async function saveMatchVeto(matchId: string, vetoLines: string[]) {
  const { data: current, error: loadError } = await supabaseAdmin
    .from('matches')
    .select('metadata')
    .eq('id', matchId)
    .maybeSingle()
  if (loadError || !current) throw error(500, 'Failed to load the match for the veto')

  const { error: updateError } = await supabaseAdmin
    .from('matches')
    .update({
      metadata: {
        ...((current.metadata as Record<string, unknown> | null) ?? {}),
        map_vetoes: vetoLines,
      },
    })
    .eq('id', matchId)
  if (updateError) throw error(500, 'Failed to save the veto')
}

export function parseVetoText(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return []
  return normalizeVetoLines(value.split(/\r?\n/))
}

/**
 * Fetch a submission's maps against the match and list every reason it should
 * wait for an admin. Hard input problems (an unreadable link, a game still in
 * progress, a Riot lookup failure) throw instead: the captain can fix those
 * themselves, so they never reach the queue.
 */
export async function evaluateSubmission(opts: {
  match: ReportableMatch
  trackerInput: string
  region: MatchRegion
  forfeitMap: ForfeitMapSpec | null
  note: string | null
  /** Rate-limit hook, called once the input is known to parse. */
  beforeFetch?: () => void | Promise<void>
}): Promise<{ series: PreparedSeries; reviewReasons: string[] }> {
  const { match, forfeitMap } = opts
  if (!match.team_a_id || !match.team_b_id) {
    throw error(400, 'This match does not have both teams set yet.')
  }

  const { ids, unparsed } = parseSeriesInput(opts.trackerInput, forfeitMap)
  if (unparsed.length > 0) {
    throw error(
      400,
      `Couldn't read ${unparsed.length === 1 ? 'this line' : 'these lines'} as a tracker link or match id: ${unparsed.join(', ')}`
    )
  }
  await opts.beforeFetch?.()

  const [prepared, hasStats, elsewhere] = await Promise.all([
    prepareRiotSeries({
      ids,
      unparsed,
      region: opts.region,
      targetMatch: {
        id: match.id,
        team_a_id: match.team_a_id,
        team_b_id: match.team_b_id,
        season_id: match.season_id,
      },
      forfeitMap,
    }),
    matchHasStats(match.id),
    idsImportedElsewhere(ids, match.id),
  ])
  // A target match always supplies the teams, so this only narrows the type.
  if (!prepared.ok) throw error(422, prepared.reason)
  const { series } = prepared

  const reasons: string[] = []
  if (forfeitMap) reasons.push('Includes a forfeited map.')
  if (opts.note) reasons.push('The captain left a note for admins.')
  if (hasStats) reasons.push('This match already has stats — a new submission would replace them.')
  if (!match.stage) reasons.push('The match has no stage set, so it cannot be filed automatically.')
  if (elsewhere.length > 0) {
    reasons.push(
      `${elsewhere.length === 1 ? 'A map is' : `${elsewhere.length} maps are`} already imported on a different match.`
    )
  }

  // Every map's lobby, read with no teams supplied, must vote for this match's
  // own two teams. A sub or two is fine (the vote needs two per side); a lobby
  // that reads as another team, or can't be read, is not.
  const matchTeams = new Set([match.team_a_id, match.team_b_id])
  series.autoTeamChecks.forEach((check, index) => {
    const label = `Map ${index + 1}`
    if (!check.ok) {
      reasons.push(`${label}: the rosters couldn't confirm the teams — ${check.reason}`)
    } else if (!check.teamIds.every((id) => matchTeams.has(id))) {
      reasons.push(`${label}: the lobby looks like a different team than this match.`)
    }
  })

  const bestOf = Number(match.best_of)
  const scoreProblem = checkSeriesScore(series.preview.maps, bestOf)
  if (scoreProblem) reasons.push(scoreProblem)

  // A result someone already entered by hand has to agree with the maps.
  const recordedA = Number(match.team_a_score ?? 0)
  const recordedB = Number(match.team_b_score ?? 0)
  if (match.status === 'completed' && recordedA + recordedB > 0) {
    const fromMaps = seriesScore(series.preview.maps)
    // preview team A is the match's team A whenever a target match is given.
    if (fromMaps.a !== recordedA || fromMaps.b !== recordedB) {
      reasons.push(
        `The maps come to ${fromMaps.a}-${fromMaps.b}, but the match is recorded as ${recordedA}-${recordedB}.`
      )
    }
  }

  return { series, reviewReasons: reasons }
}

/** Import a prepared submission onto its match. */
export async function applySubmission(
  match: ReportableMatch,
  series: PreparedSeries,
  importerProfileId: string
) {
  if (!match.stage) throw error(400, 'Set a stage on the match before importing.')
  const result = await commitRiotSeries(series, {
    stage: match.stage,
    bestOf: match.best_of,
    targetMatchId: match.id,
    importerProfileId,
    displayName: `Captain report ${match.id}`,
  })
  // Both rosters hear the final result, as they do for an admin-entered one.
  await notifyMatchResult(match.id, importerProfileId)
  return result
}

/**
 * What the match page needs to show the captain submission panel, or null when
 * the viewer can't submit for this match (not a captain of either team, or the
 * match hasn't been played).
 */
export async function getMatchReportState(
  viewerProfileId: string | null,
  match: Pick<ReportableMatch, 'id' | 'status' | 'scheduled_at' | 'team_a_id' | 'team_b_id'>
) {
  if (!viewerProfileId || !isMatchConcluded(match)) return null
  const captainTeamId = await captainTeamForMatch(viewerProfileId, match)
  if (!captainTeamId) return null

  const { data: latest } = await supabaseAdmin
    .from('match_reports')
    .select('id, status, review_reasons, review_note, created_at, team_id')
    .eq('match_id', match.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    captainTeamId,
    latest: latest
      ? {
          id: String(latest.id),
          status: latest.status as 'applied' | 'pending' | 'rejected',
          reviewReasons: (latest.review_reasons as string[] | null) ?? [],
          reviewNote: (latest.review_note as string | null) ?? null,
          createdAt: String(latest.created_at),
          byOwnTeam: latest.team_id === captainTeamId,
        }
      : null,
  }
}

export type MatchReportRow = {
  id: string
  match_id: string
  team_id: string | null
  submitted_by_profile_id: string | null
  status: 'applied' | 'pending' | 'rejected'
  tracker_input: string
  region: string
  veto_lines: string[]
  forfeit_map: ForfeitMapSpec | null
  note: string | null
  review_reasons: string[]
  preview: SeriesPreview | null
  reviewed_by_profile_id: string | null
  reviewed_at: string | null
  review_note: string | null
  created_at: string
}

export const MATCH_REPORT_SELECT =
  'id, match_id, team_id, submitted_by_profile_id, status, tracker_input, region, veto_lines, forfeit_map, note, review_reasons, preview, reviewed_by_profile_id, reviewed_at, review_note, created_at'
