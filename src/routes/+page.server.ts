import { supabaseAdmin } from '$lib/supabase/admin'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import type { MatchStreamRow } from '$lib/server/db-rows'
import { isUnreachableError } from '$lib/server/supabase/unreachable'
import { getSeasonStandingsRanks } from '$lib/server/leaderboard/ranks'
import { loadRecentComments } from '$lib/server/comments/recent'
import { loadSignupSeason } from '$lib/server/signups/season'
import { getSeasonLogoUrl } from '$lib/server/seasons/logo'
import { resolveSeasonSchedule } from '$lib/seasons/schedule'

const MATCH_COLUMNS = `
  id,
  season_id,
  status,
  best_of,
  scheduled_at,
  team_a_score,
  team_b_score,
  metadata,
  team_a:teams!matches_team_a_id_fkey (id, name, tag, logo_path),
  team_b:teams!matches_team_b_id_fkey (id, name, tag, logo_path)
`

/** How many upcoming matches the "Up next" strip shows. */
const UPCOMING_LIMIT = 5
const RECENT_RESULTS_LIMIT = 3

type TeamRef = { id: string; name: string; tag: string | null; logo_path: string | null }

function withLogo(value: TeamRef | TeamRef[] | null) {
  const team = Array.isArray(value) ? value[0] : value
  return team ? { ...team, logo_url: getTeamLogoUrl(team) } : null
}

type RawMatch = {
  id: string
  status: string
  best_of: number
  scheduled_at: string | null
  team_a_score: number | null
  team_b_score: number | null
  metadata: unknown
  team_a: unknown
  team_b: unknown
}

function normalizeMatch(match: RawMatch) {
  return {
    ...match,
    designation: (match.metadata as Record<string, unknown> | null)?.designation ?? null,
    team_a: withLogo(match.team_a as TeamRef | TeamRef[] | null),
    team_b: withLogo(match.team_b as TeamRef | TeamRef[] | null),
  }
}

/**
 * The landing page: one hero chosen from the season's state, plus short
 * a preview of the schedule. The full feed lives at /matches.
 */
export const load = async () => {
  const [{ data: season, error: seasonError }, signupSeason, recentComments] = await Promise.all([
    supabaseAdmin
      .from('seasons')
      .select('id, code, name, kind, starts_on, ends_on, metadata, logo_path')
      .eq('is_active', true)
      .maybeSingle(),
    loadSignupSeason(),
    loadRecentComments(12),
  ])

  if (seasonError) console.error('Failed to load active season:', seasonError)
  const unreachable = isUnreachableError(seasonError)

  const seasonId = season?.id ?? null

  // A season other than the active one taking signups is the upcoming
  // tournament, and the hero is about it — so it needs its own logo and dates.
  const upcomingSignup =
    signupSeason && signupSeason.id !== seasonId
      ? (
          await supabaseAdmin
            .from('seasons')
            .select('id, code, name, starts_on, logo_path')
            .eq('id', signupSeason.id)
            .maybeSingle()
        ).data
      : null

  // Unfinished matches, soonest first. Anything past its start time is treated
  // as live on the client, same as the /matches feed.
  let openQuery = supabaseAdmin
    .from('matches')
    .select(MATCH_COLUMNS)
    .eq('approval_status', 'approved')
    .not('status', 'in', '(completed,cancelled)')
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .limit(UPCOMING_LIMIT + 5)
  let recentQuery = supabaseAdmin
    .from('matches')
    .select(MATCH_COLUMNS)
    .eq('approval_status', 'approved')
    .eq('status', 'completed')
    .order('scheduled_at', { ascending: false, nullsFirst: false })
    .limit(RECENT_RESULTS_LIMIT)
  if (seasonId) {
    openQuery = openQuery.eq('season_id', seasonId)
    recentQuery = recentQuery.eq('season_id', seasonId)
  }

  const [openRes, recentRes, teamsRes, playedRes, playersRes, ranks] = await Promise.all([
    openQuery,
    recentQuery,
    seasonId
      ? supabaseAdmin
          .from('teams')
          .select('id, name, tag, logo_path')
          .eq('season_id', seasonId)
          .eq('approval_status', 'approved')
      : Promise.resolve({ data: [] as TeamRef[], error: null }),
    seasonId
      ? supabaseAdmin
          .from('matches')
          .select('id', { count: 'exact', head: true })
          .eq('season_id', seasonId)
          .eq('approval_status', 'approved')
          .eq('status', 'completed')
      : Promise.resolve({ count: 0, error: null }),
    seasonId
      ? supabaseAdmin
          .from('team_memberships')
          .select('id', { count: 'exact', head: true })
          .eq('season_id', seasonId)
          .eq('is_active', true)
      : Promise.resolve({ count: 0, error: null }),
    seasonId ? getSeasonStandingsRanks(seasonId) : Promise.resolve({} as Record<string, number>),
  ])

  if (openRes.error) console.error('Failed to load upcoming matches:', openRes.error)
  if (recentRes.error) console.error('Failed to load recent results:', recentRes.error)

  const upcoming = ((openRes.data ?? []) as RawMatch[]).map(normalizeMatch)
  const recentResults = ((recentRes.data ?? []) as RawMatch[]).map(normalizeMatch)

  // Streams only matter for a match that might be live right now.
  const liveCandidateIds = upcoming
    .filter(
      (m) => m.status === 'live' || (m.scheduled_at && Date.parse(m.scheduled_at) <= Date.now())
    )
    .map((m) => m.id)
  const streamsByMatch: Record<string, MatchStreamRow[]> = {}
  if (liveCandidateIds.length > 0) {
    const { data: streams } = await supabaseAdmin
      .from('match_streams')
      .select('id, match_id, platform, stream_url, is_primary, status, metadata')
      .in('match_id', liveCandidateIds)
      .order('is_primary', { ascending: false })
    for (const stream of (streams ?? []) as MatchStreamRow[]) {
      ;(streamsByMatch[stream.match_id] ??= []).push(stream)
    }
  }

  const teams = ((teamsRes.data ?? []) as TeamRef[]).map((t) => ({
    ...t,
    logo_url: getTeamLogoUrl(t),
  }))

  return {
    season: season
      ? {
          id: season.id,
          code: season.code,
          name: season.name,
          startsOn: season.starts_on as string | null,
          endsOn: season.ends_on as string | null,
          logoUrl: getSeasonLogoUrl(season),
          schedule: resolveSeasonSchedule(season.metadata as Record<string, unknown> | null),
        }
      : null,
    // A separately flagged signup season (the next one) gets the hero; the
    // active season's own always-open signups are only a secondary button.
    upcomingSignup: upcomingSignup
      ? {
          id: upcomingSignup.id,
          code: upcomingSignup.code,
          name: upcomingSignup.name,
          startsOn: upcomingSignup.starts_on as string | null,
          logoUrl: getSeasonLogoUrl(upcomingSignup),
        }
      : null,
    upcoming: upcoming.map((m) => ({ ...m, streams: streamsByMatch[m.id] ?? [] })),
    recentResults,
    seeds: ranks,
    heroLogos: teams.map((t) => t.logo_url).filter((url): url is string => Boolean(url)),
    stats: {
      teams: teams.length,
      players: playersRes.count ?? 0,
      matchesPlayed: playedRes.count ?? 0,
    },
    recentComments,
    unreachable,
  }
}
