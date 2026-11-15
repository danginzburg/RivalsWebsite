import { supabaseAdmin } from '$lib/supabase/admin'
import { resolveMatchStage } from '$lib/server/stats/from-matches'
import {
  isOutOfGroup,
  type StandingsAdjustment,
  type StandingsMatch,
} from '$lib/server/leaderboard/compute'
import {
  weeklyRanks,
  type DatedStandingsMatch,
  type RankPoint,
} from '$lib/server/leaderboard/rank-history'

import { withPlayoffPlacements, type DatedBracket } from '$lib/server/leaderboard/playoff-placement'
import { getPickemResults, getPublishedPickemContextBySeasonId } from '$lib/server/pickems'

export type { RankPoint }

/** The season's published bracket with a date on every decided slot, or null. */
async function loadDatedBracket(
  seasonId: string,
  matchDates: Map<string, string | null>
): Promise<DatedBracket | null> {
  const ctx = await getPublishedPickemContextBySeasonId(seasonId)
  if (ctx.event?.format !== 'bracket' || ctx.matches.length === 0) return null
  const { linkedResults, sourceMatchIds } = await getPickemResults(ctx.event, ctx.matches)
  const playedAt: Record<string, number> = {}
  for (const [slot, matchId] of Object.entries(sourceMatchIds)) {
    const at = matchDates.get(matchId)
    const ms = at ? Date.parse(at) : NaN
    if (Number.isFinite(ms)) playedAt[slot] = ms
  }
  return { event: ctx.event, matches: ctx.matches, linkedResults, playedAt }
}

type MatchRow = {
  id: string
  stage: string | null
  metadata: Record<string, unknown> | null
  scheduled_at: string | null
  ended_at: string | null
  team_a_id: string
  team_b_id: string
  team_a_score: number | null
  team_b_score: number | null
  winner_team_id: string | null
  match_maps: StandingsMatch['maps'] | null
}

/** Load a season and replay it for one team. Empty when there is nothing to plot. */
export async function loadTeamRankHistory(seasonId: string, teamId: string): Promise<RankPoint[]> {
  const [seasonRes, teamsRes, matchesRes, adjRes] = await Promise.all([
    supabaseAdmin.from('seasons').select('kind').eq('id', seasonId).maybeSingle(),
    supabaseAdmin
      .from('teams')
      .select('id, name, status')
      .eq('season_id', seasonId)
      .eq('approval_status', 'approved'),
    supabaseAdmin
      .from('matches')
      .select(
        'id, stage, metadata, scheduled_at, ended_at, team_a_id, team_b_id, team_a_score, team_b_score, winner_team_id, match_maps (team_a_rounds, team_b_rounds, is_voided)'
      )
      .eq('season_id', seasonId)
      .eq('status', 'completed')
      .eq('approval_status', 'approved'),
    supabaseAdmin
      .from('leaderboard_adjustments')
      .select('team_id, wins, losses, map_wins, map_losses, round_diff, points, rank_override')
      .eq('season_id', seasonId),
  ])
  if (teamsRes.error || matchesRes.error) return []

  const teams = (
    (teamsRes.data ?? []) as Array<{ id: string; name: string; status: string | null }>
  ).filter((t) => t.status !== 'disbanded')
  const matches: DatedStandingsMatch[] = ((matchesRes.data ?? []) as MatchRow[]).map((m) => ({
    id: m.id,
    stage: resolveMatchStage({ stage: m.stage, metadata: m.metadata } as never),
    at: m.scheduled_at ?? m.ended_at,
    team_a_id: m.team_a_id,
    team_b_id: m.team_b_id,
    team_a_score: m.team_a_score,
    team_b_score: m.team_b_score,
    winner_team_id: m.winner_team_id,
    out_of_group: isOutOfGroup(m.metadata),
    maps: m.match_maps ?? [],
  }))
  const adjustments = (adjRes.error ? [] : (adjRes.data ?? [])) as StandingsAdjustment[]

  const weekly = weeklyRanks(teamId, teams, matches, adjustments, {
    awardPoints: seasonRes.data?.kind === 'external',
  })
  if (weekly.length === 0) return weekly

  // Playoff results take over the line once the bracket starts deciding places.
  const matchDates = new Map(matches.map((m) => [m.id, m.at]))
  const bracket = await loadDatedBracket(seasonId, matchDates).catch(() => null)
  return withPlayoffPlacements(weekly, bracket, teamId)
}
