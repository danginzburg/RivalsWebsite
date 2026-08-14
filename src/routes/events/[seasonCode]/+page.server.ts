import { error } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import {
  buildPlayoffBracketSlots,
  playoffPickemConfigFromSeasonMetadata,
  type PlayoffMatchId,
} from '$lib/playoffPickems'
import { safeNumber } from '$lib/server/parse'
import { loadCommentThread } from '$lib/server/comments'
import { getViewerProfileId } from '$lib/server/auth/viewer'
import { getSeasonLogoUrl } from '$lib/server/seasons/logo'
import { isUnreachableError } from '$lib/server/supabase/unreachable'

type TeamRel = { id: string; name: string; tag?: string | null; logo_path?: string | null }
type ProfileRel = { id: string; display_name: string | null; riot_id_base: string | null }

function firstRel<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export const load = async ({
  params,
  locals,
}: {
  params: { seasonCode: string }
  locals: App.Locals
}) => {
  const isAdmin = locals.user?.role === 'admin'

  const { data: season, error: seasonError } = await supabaseAdmin
    .from('seasons')
    .select(
      `
      id,
      code,
      name,
      starts_on,
      ends_on,
      is_active,
      summary,
      metadata,
      logo_path,
      winner_team_id,
      runner_up_team_id,
      mvp_profile_id,
      final_leaderboard_batch_id,
      winner:teams!seasons_winner_team_id_fkey (id, name, tag, logo_path),
      runner_up:teams!seasons_runner_up_team_id_fkey (id, name, tag, logo_path),
      mvp:profiles!seasons_mvp_profile_id_fkey (id, display_name, riot_id_base)
    `
    )
    .eq('code', params.seasonCode)
    .maybeSingle()

  // A transport failure is not a missing season — reporting 404 for an outage
  // tells the visitor the event was deleted.
  if (isUnreachableError(seasonError)) {
    throw error(503, 'Could not reach the server. This is usually temporary — try again shortly.')
  }
  if (seasonError || !season) throw error(404, 'Season not found')

  // Teams, matches, and the leaderboard snapshot all scope to this season.
  const [{ data: teamRows }, { data: matchRows }] = await Promise.all([
    supabaseAdmin
      .from('teams')
      .select('id, name, tag, logo_path, created_at')
      .eq('season_id', season.id)
      .eq('approval_status', 'approved')
      .order('name', { ascending: true }),
    supabaseAdmin
      .from('matches')
      .select(
        `
        id,
        status,
        best_of,
        scheduled_at,
        ended_at,
        team_a_score,
        team_b_score,
        winner_team_id,
        metadata,
        team_a:teams!matches_team_a_id_fkey (id, name, tag, logo_path),
        team_b:teams!matches_team_b_id_fkey (id, name, tag, logo_path)
      `
      )
      .eq('season_id', season.id)
      .eq('approval_status', 'approved')
      .order('scheduled_at', { ascending: false, nullsFirst: false }),
  ])

  const teams = (teamRows ?? []).map((team) => ({
    id: team.id,
    name: team.name,
    tag: team.tag ?? null,
    logo_url: getTeamLogoUrl(team),
  }))

  // Bracket teams are looked up by id, and may include teams from other seasons
  // if the bracket was configured before season-scoping — so merge in any that
  // the seed list references but the season roster is missing.
  const pickem = playoffPickemConfigFromSeasonMetadata(season.metadata)
  const teamMap: Record<string, (typeof teams)[number]> = {}
  for (const team of teams) teamMap[team.id] = team

  const missingBracketTeamIds = pickem.seeds.map((s) => s.teamId).filter((id) => id && !teamMap[id])

  if (missingBracketTeamIds.length > 0) {
    const { data: extraTeams } = await supabaseAdmin
      .from('teams')
      .select('id, name, tag, logo_path')
      .in('id', missingBracketTeamIds)

    for (const team of extraTeams ?? []) {
      teamMap[team.id] = {
        id: team.id,
        name: team.name,
        tag: team.tag ?? null,
        logo_url: getTeamLogoUrl(team),
      }
    }
  }

  /**
   * The bracket's winners come from the real matches its slots are linked to,
   * not from the pick'em's `resolved_matches` list — that list is only filled
   * in for games decided before the pick'em opened, so on its own it leaves
   * most of an already-played bracket showing TBD.
   *
   * `buildPlayoffBracketSlots` layers `resolved_matches` on top of the payload,
   * so an explicit admin resolution still wins over a linked result.
   */
  const linkedMatchIds = pickem.match_links
    .map((link) => link.actualMatchId)
    .filter((id): id is string => Boolean(id))

  const actualPicks: Partial<Record<PlayoffMatchId, string>> = {}
  if (linkedMatchIds.length > 0) {
    const { data: linkedMatches } = await supabaseAdmin
      .from('matches')
      .select('id, winner_team_id')
      .in('id', linkedMatchIds)

    const winnerByMatchId = new Map(
      (linkedMatches ?? []).map((m) => [m.id, m.winner_team_id as string | null])
    )

    for (const link of pickem.match_links) {
      if (!link.actualMatchId) continue
      const winner = winnerByMatchId.get(link.actualMatchId)
      if (winner) actualPicks[link.matchId] = winner
    }
  }

  const bracketSlots =
    pickem.enabled && pickem.seeds.length > 0
      ? buildPlayoffBracketSlots(pickem, { picks: actualPicks })
      : []

  const matches = (matchRows ?? []).map((match) => {
    const teamA = firstRel(match.team_a as TeamRel | TeamRel[] | null)
    const teamB = firstRel(match.team_b as TeamRel | TeamRel[] | null)
    return {
      id: match.id,
      status: match.status,
      best_of: match.best_of,
      scheduled_at: match.scheduled_at,
      team_a_score: match.team_a_score,
      team_b_score: match.team_b_score,
      winner_team_id: match.winner_team_id,
      designation: (match.metadata as Record<string, unknown> | null)?.designation ?? null,
      team_a: teamA
        ? {
            id: teamA.id,
            name: teamA.name,
            tag: teamA.tag ?? null,
            logo_url: getTeamLogoUrl(teamA),
          }
        : null,
      team_b: teamB
        ? {
            id: teamB.id,
            name: teamB.name,
            tag: teamB.tag ?? null,
            logo_url: getTeamLogoUrl(teamB),
          }
        : null,
    }
  })

  // Final standings: use the pinned batch when set, otherwise the newest
  // leaderboard import *belonging to this season* so in-progress seasons still
  // show a table.
  let leaderboard: Array<{
    rank: number
    points: number
    wins: number
    losses: number
    team: { id: string; name: string; tag: string | null; logo_url: string | null } | null
  }> = []
  let leaderboardLabel: string | null = null

  let batchId = season.final_leaderboard_batch_id as string | null
  if (!batchId) {
    /**
     * Which batches are this season's is decided by the season of the teams in
     * them, not by `stat_import_batches.season_id` — that column is NULL on the
     * Google Sheets imports, which are the most recent standings we have. It is
     * also not enough to just take the newest batch overall: doing that showed
     * Season 4's table on every event page, because every leaderboard import in
     * the database so far belongs to Season 4.
     */
    const { data: seasonEntries } = await supabaseAdmin
      .from('leaderboard_entries')
      .select('import_batch_id, teams:teams!leaderboard_entries_team_id_fkey!inner (season_id)')
      .eq('teams.season_id', season.id)
      .not('import_batch_id', 'is', null)

    const candidateIds = Array.from(
      new Set((seasonEntries ?? []).map((entry) => entry.import_batch_id as string))
    )

    if (candidateIds.length > 0) {
      const { data: latestBatch } = await supabaseAdmin
        .from('stat_import_batches')
        .select('id, display_name, metadata')
        .in('id', candidateIds)
        .filter('metadata->>import_type', 'eq', 'leaderboard_entries')
        .eq('status', 'applied')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      batchId = latestBatch?.id ?? null
      leaderboardLabel = latestBatch
        ? (latestBatch.metadata?.display_name ?? latestBatch.display_name ?? 'Latest standings')
        : null
    }
  } else {
    const { data: pinnedBatch } = await supabaseAdmin
      .from('stat_import_batches')
      .select('id, display_name, metadata')
      .eq('id', batchId)
      .maybeSingle()
    leaderboardLabel = pinnedBatch
      ? (pinnedBatch.metadata?.display_name ?? pinnedBatch.display_name ?? 'Final standings')
      : null
  }

  if (batchId) {
    const { data: entries } = await supabaseAdmin
      .from('leaderboard_entries')
      .select(
        `
        rank,
        points,
        wins,
        losses,
        teams:teams!leaderboard_entries_team_id_fkey (id, name, tag, logo_path)
        `
      )
      .eq('import_batch_id', batchId)
      .order('rank', { ascending: true, nullsFirst: false })
      .order('points', { ascending: false })

    leaderboard = (entries ?? []).map((entry) => {
      const team = firstRel(entry.teams as TeamRel | TeamRel[] | null)
      return {
        rank: safeNumber(entry.rank),
        points: safeNumber(entry.points),
        wins: safeNumber(entry.wins),
        losses: safeNumber(entry.losses),
        team: team
          ? { id: team.id, name: team.name, tag: team.tag ?? null, logo_url: getTeamLogoUrl(team) }
          : null,
      }
    })
  }

  const viewerProfileId = await getViewerProfileId(locals.user)
  const comments = await loadCommentThread('season', season.id, {
    includeReportCounts: isAdmin,
    viewerProfileId,
  })

  const winner = firstRel(season.winner as TeamRel | TeamRel[] | null)
  const runnerUp = firstRel(season.runner_up as TeamRel | TeamRel[] | null)
  const mvp = firstRel(season.mvp as unknown as ProfileRel | ProfileRel[] | null)

  return {
    season: {
      id: season.id,
      code: season.code,
      name: season.name,
      starts_on: season.starts_on,
      ends_on: season.ends_on,
      is_active: season.is_active,
      summary: season.summary ?? null,
      logo_url: getSeasonLogoUrl(season),
      winner: winner
        ? {
            id: winner.id,
            name: winner.name,
            tag: winner.tag ?? null,
            logo_url: getTeamLogoUrl(winner),
          }
        : null,
      runner_up: runnerUp
        ? {
            id: runnerUp.id,
            name: runnerUp.name,
            tag: runnerUp.tag ?? null,
            logo_url: getTeamLogoUrl(runnerUp),
          }
        : null,
      mvp: mvp ? { id: mvp.id, name: mvp.riot_id_base ?? mvp.display_name ?? 'Player' } : null,
    },
    teams,
    matches,
    leaderboard,
    leaderboardLabel,
    bracket: {
      slots: bracketSlots,
      teams: teamMap,
      // Seeds actually assigned a team — how many made playoffs.
      teamCount: pickem.seeds.filter((seed) => Boolean(seed.teamId)).length,
      // Seed number keyed by team id, for display in the bracket.
      seeds: Object.fromEntries(
        pickem.seeds.filter((s) => s.teamId).map((s) => [s.teamId, s.seed])
      ) as Record<string, number>,
    },
    comments,
    viewer: { isAdmin, profileId: viewerProfileId },
  }
}
