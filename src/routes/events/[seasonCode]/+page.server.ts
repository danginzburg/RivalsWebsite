import { error } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import {
  buildPlayoffBracketSlots,
  playoffPickemConfigFromSeasonMetadata,
} from '$lib/playoffPickems'
import { safeNumber } from '$lib/server/parse'

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

  const bracketSlots =
    pickem.enabled && pickem.seeds.length > 0 ? buildPlayoffBracketSlots(pickem) : []

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
  // leaderboard import so in-progress seasons still show a table.
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
    const { data: latestBatch } = await supabaseAdmin
      .from('stat_import_batches')
      .select('id, display_name, metadata')
      .filter('metadata->>import_type', 'eq', 'leaderboard_entries')
      .eq('status', 'applied')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    batchId = latestBatch?.id ?? null
    leaderboardLabel = latestBatch
      ? (latestBatch.metadata?.display_name ?? latestBatch.display_name ?? 'Latest standings')
      : null
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
    bracket: { slots: bracketSlots, teams: teamMap },
    viewer: { isAdmin },
  }
}
