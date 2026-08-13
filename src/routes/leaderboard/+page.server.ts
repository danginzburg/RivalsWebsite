import { supabaseAdmin } from '$lib/supabase/admin'
import { safeNumber } from '$lib/server/parse'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { publicDataCache } from '$lib/server/cache'
import { getActiveSeasonSeeds } from '$lib/server/seasons/seeds'

type TeamRel = {
  id: string
  name: string
  tag?: string | null
  logo_path?: string | null
  approval_status?: string | null
  metadata?: Record<string, unknown> | null
}

type EntryRow = {
  team_id: string
  rank: number | null
  points: number | null
  matches_played: number | null
  wins: number | null
  losses: number | null
  map_wins: number | null
  map_losses: number | null
  round_diff: number | null
}

export type StandingsRow = {
  id: string
  name: string
  tag: string | null
  logo_url: string | null
  org: string | null
  /** Null when the team has no entry in the current standings. */
  stats: {
    rank: number
    points: number
    series_played: number
    series_wins: number
    series_losses: number
    maps_played: number
    map_wins: number
    map_losses: number
    round_diff: number
  } | null
}

/**
 * Standings plus the full team directory. These were two pages that showed
 * overlapping data; teams without a leaderboard entry still appear so the
 * page remains a complete roster of the league.
 */
async function loadStandings() {
  // The batch, the team directory and the bracket seeds are independent of one
  // another; only the entries query needs to wait on them.
  const [{ data: batch }, { data: teams }, seeds] = await Promise.all([
    supabaseAdmin
      .from('stat_import_batches')
      .select('id, display_name, source_filename, created_at, metadata')
      .filter('metadata->>import_type', 'eq', 'leaderboard_entries')
      .eq('status', 'applied')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('teams')
      .select('id, name, tag, logo_path, metadata')
      .eq('approval_status', 'approved')
      .order('name', { ascending: true }),
    // Seeds come from the active season's bracket, matching the team list.
    getActiveSeasonSeeds(),
  ])

  const teamIds = (teams ?? []).map((t) => t.id)

  const { data: entries } =
    batch && teamIds.length > 0
      ? await supabaseAdmin
          .from('leaderboard_entries')
          .select(
            'team_id, rank, points, matches_played, wins, losses, map_wins, map_losses, round_diff'
          )
          .eq('import_batch_id', batch.id)
          .in('team_id', teamIds)
      : { data: [] as EntryRow[] }

  const entryByTeam = new Map<string, EntryRow>()
  for (const entry of (entries ?? []) as EntryRow[]) entryByTeam.set(entry.team_id, entry)

  const rows: StandingsRow[] = (teams ?? []).map((team) => {
    const entry = entryByTeam.get(team.id)
    return {
      id: team.id,
      name: team.name,
      tag: team.tag ?? null,
      logo_url: getTeamLogoUrl(team),
      org: (team.metadata as Record<string, unknown> | null)?.org
        ? String((team.metadata as Record<string, unknown>).org)
        : null,
      stats: entry
        ? {
            rank: safeNumber(entry.rank),
            points: safeNumber(entry.points),
            series_played: safeNumber(entry.matches_played),
            series_wins: safeNumber(entry.wins),
            series_losses: safeNumber(entry.losses),
            maps_played: safeNumber(entry.map_wins) + safeNumber(entry.map_losses),
            map_wins: safeNumber(entry.map_wins),
            map_losses: safeNumber(entry.map_losses),
            round_diff: safeNumber(entry.round_diff),
          }
        : null,
    }
  })

  // Ranked teams first in rank order, then unranked alphabetically.
  rows.sort((a, b) => {
    const ar = a.stats?.rank || Number.MAX_SAFE_INTEGER
    const br = b.stats?.rank || Number.MAX_SAFE_INTEGER
    if (ar !== br) return ar - br
    return a.name.localeCompare(b.name)
  })

  return {
    rows,
    seeds,
    batch: batch
      ? {
          display_name:
            (batch.metadata as Record<string, unknown> | null)?.display_name ??
            batch.display_name ??
            batch.source_filename,
          as_of_date: (batch.metadata as Record<string, unknown> | null)?.as_of_date ?? null,
        }
      : null,
  }
}

/** The signed-in viewer's team, if they are on one. Never cached. */
async function loadMyTeam(authSub: string | undefined) {
  if (!authSub) return null

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('auth0_sub', authSub)
    .maybeSingle()

  if (!profile?.id) return null

  const { data: membership } = await supabaseAdmin
    .from('team_memberships')
    .select('team_id, role, teams (id, name, tag, logo_path, approval_status, metadata)')
    .eq('profile_id', profile.id)
    .eq('is_active', true)
    .is('left_at', null)
    .maybeSingle()

  const rel = (membership as { teams?: TeamRel | TeamRel[] | null } | null)?.teams
  const team = Array.isArray(rel) ? rel[0] : rel
  if (team?.approval_status !== 'approved') return null

  return {
    id: team.id,
    name: team.name,
    tag: team.tag ?? null,
    logo_url: getTeamLogoUrl(team),
    role: (membership as { role?: string | null } | null)?.role ?? null,
  }
}

export const load = async ({ locals }: { locals: App.Locals }) => {
  // Only the shared standings are cached — myTeam is per-viewer and must not
  // be served from a shared cache.
  const standings = (await publicDataCache.wrap('leaderboard:standings', loadStandings)) as Awaited<
    ReturnType<typeof loadStandings>
  >

  const myTeam = await loadMyTeam(locals.user?.sub)

  return {
    rows: standings.rows,
    seeds: standings.seeds,
    batch: standings.batch,
    myTeam,
    viewer: { isAdmin: locals.user?.role === 'admin' },
  }
}
