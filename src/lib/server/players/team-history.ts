import { supabaseAdmin } from '$lib/supabase/admin'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { isShortStint } from '$lib/server/matches/subs'
import { loadSeasonThirdPlaceTeamIds } from '$lib/server/seasons/thirdPlace'

/* Team history for the player profile page. */

export type TeamRel = {
  id: string
  name: string
  tag?: string | null
  logo_path?: string | null
  approval_status?: string | null
}

export type SeasonRel = {
  id: string
  name?: string | null
  code?: string | null
  starts_on?: string | null
  winner_team_id?: string | null
  runner_up_team_id?: string | null
  mvp_profile_id?: string | null
}

export type MembershipTeamRel = TeamRel & {
  season_id?: string | null
  seasons?: SeasonRel | SeasonRel[] | null
}

export type TeamHistoryRow = {
  /** Team id doubles as the key — one row per team, however many stints. */
  team: { id: string; name: string; tag: string | null; logo_url: string | null }
  season: { id: string; name: string; code: string | null } | null
  role: string | null
  joined_at: string | null
  /** When the player left this team; null while any stint on it is still open. */
  left_at: string | null
  /** Sort key: when this team's season began, empty for an unassigned team. */
  season_started_on: string
  /** Final finish, set only once the season's results have been recorded. */
  placement: 'champion' | 'runner_up' | 'third' | null
  /** The player was that season's MVP; carried on one row per season. */
  is_mvp: boolean
}

/**
 * Every team this player has been rostered on, newest season first.
 *
 * Unapproved teams are left out: their team pages 404 for ordinary visitors, so
 * a row for one would be a dead link.
 *
 * Rosters carry duplicate rows for the same player and team — a re-add writes a
 * second membership rather than reviving the first — so stints are collapsed to
 * one row per team. A genuine move between two teams still shows as two rows.
 *
 * An open membership is not read as "current team". Rosters are season-scoped,
 * so a backfilled past season leaves its memberships open indefinitely and an
 * open membership says nothing about where the player is today; the season column
 * carries that information instead. A closed one does carry a fact, though: the
 * player left that team, typically by moving to another mid-event, so its
 * departure date is kept for the row.
 */
export async function loadTeamHistory(profileId: string): Promise<TeamHistoryRow[]> {
  // `seasons` has three FKs back to `teams` (season_id, winner, runner-up), so
  // the embed has to name the one it means or PostgREST refuses the query.
  const { data, error: historyError } = await supabaseAdmin
    .from('team_memberships')
    .select(
      `
      id,
      role,
      is_active,
      joined_at,
      left_at,
      teams (
        id, name, tag, logo_path, approval_status, season_id,
        seasons!teams_season_id_fkey (
          id, name, code, starts_on, winner_team_id, runner_up_team_id, mvp_profile_id
        )
      )
    `
    )
    .eq('profile_id', profileId)
    .order('joined_at', { ascending: false, nullsFirst: false })

  if (historyError) {
    console.error('Failed to load team history:', historyError)
    return []
  }

  type Row = {
    id: number
    role?: string | null
    is_active?: boolean | null
    joined_at?: string | null
    left_at?: string | null
    teams?: MembershipTeamRel | MembershipTeamRel[] | null
  }

  const byTeam = new Map<string, TeamHistoryRow>()
  const openTeams = new Set<string>()
  const mvpSeasonByTeam = new Map<string, string>()
  const seasonByTeam = new Map<string, string>()
  const bracketSeasonIds = new Set<string>()
  for (const row of (data ?? []) as Row[]) {
    const team = Array.isArray(row.teams) ? row.teams[0] : row.teams
    if (!team || team.approval_status !== 'approved') continue
    // Closed within a day of opening: a roster mis-entry, not a stint on the team.
    if (isShortStint(row.joined_at, row.left_at)) continue

    const seasonRel = Array.isArray(team.seasons) ? team.seasons[0] : team.seasons
    const isOpen = Boolean(row.is_active) && !row.left_at
    const existing = byTeam.get(team.id)

    if (existing) {
      // Merge the stints, keeping the earliest join.
      if (row.joined_at && (!existing.joined_at || row.joined_at < existing.joined_at)) {
        existing.joined_at = row.joined_at
      }
      // An open stint's role is the one worth showing.
      if (isOpen && row.role) existing.role = row.role
      if (isOpen) openTeams.add(team.id)
      else if (row.left_at && (!existing.left_at || row.left_at > existing.left_at)) {
        existing.left_at = row.left_at
      }
      continue
    }

    byTeam.set(team.id, {
      team: {
        id: team.id,
        name: team.name,
        tag: team.tag ?? null,
        logo_url: getTeamLogoUrl(team),
      },
      season: seasonRel
        ? { id: seasonRel.id, name: seasonRel.name ?? 'Season', code: seasonRel.code ?? null }
        : null,
      role: row.role ?? null,
      joined_at: row.joined_at ?? null,
      left_at: isOpen ? null : (row.left_at ?? null),
      season_started_on: seasonRel?.starts_on ?? '',
      // The winner and runner-up are only filled in once the season is over,
      // so their presence is what marks a finished season.
      placement:
        seasonRel?.winner_team_id === team.id
          ? 'champion'
          : seasonRel?.runner_up_team_id === team.id
            ? 'runner_up'
            : null,
      is_mvp: false,
    })
    if (isOpen) openTeams.add(team.id)
    if (seasonRel?.mvp_profile_id === profileId) mvpSeasonByTeam.set(team.id, seasonRel.id)
    if (
      seasonRel?.winner_team_id &&
      seasonRel.winner_team_id !== team.id &&
      seasonRel.runner_up_team_id !== team.id
    ) {
      bracketSeasonIds.add(seasonRel.id)
      seasonByTeam.set(team.id, seasonRel.id)
    }
  }
  for (const teamId of openTeams) {
    const entry = byTeam.get(teamId)
    if (entry) entry.left_at = null
  }

  // 3rd place comes from the season's admin-set result or, failing that, its
  // bracket — only for finished seasons where this player's team did not already place 1st/2nd.
  const thirdBySeason = new Map(
    await Promise.all(
      [...bracketSeasonIds].map(
        async (seasonId) => [seasonId, await loadSeasonThirdPlaceTeamIds(seasonId)] as const
      )
    )
  )
  for (const [teamId, seasonId] of seasonByTeam) {
    const entry = byTeam.get(teamId)
    if (entry && thirdBySeason.get(seasonId)?.includes(teamId)) entry.placement = 'third'
  }

  // Newest season first; within a season, the most recent roster first.
  const rows = [...byTeam.entries()].sort(([, a], [, b]) => {
    if (a.season_started_on !== b.season_started_on) {
      return b.season_started_on.localeCompare(a.season_started_on)
    }
    return (b.joined_at ?? '').localeCompare(a.joined_at ?? '')
  })

  // A player who moved teams mid-season has two rows for it; the MVP award
  // goes on the latest one only, rather than appearing twice.
  const mvpSeasonsShown = new Set<string>()
  for (const [teamId, entry] of rows) {
    const seasonId = mvpSeasonByTeam.get(teamId)
    if (!seasonId || mvpSeasonsShown.has(seasonId)) continue
    mvpSeasonsShown.add(seasonId)
    entry.is_mvp = true
  }

  return rows.map(([, entry]) => entry)
}
