import { supabaseAdmin } from '$lib/supabase/admin'
import { safeNumber } from '$lib/server/parse'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { publicDataCache } from '$lib/server/cache'
import { getSeasonSeeds, type SeedMap } from '$lib/server/seasons/seeds'

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
    /** Null before the season's first import, when nothing is ranked yet. */
    rank: number | null
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

/** A team the season has, but the standings have not recorded a result for. */
const ZEROED_STATS: NonNullable<StandingsRow['stats']> = {
  rank: null,
  points: 0,
  series_played: 0,
  series_wins: 0,
  series_losses: 0,
  maps_played: 0,
  map_wins: 0,
  map_losses: 0,
  round_diff: 0,
}

type BatchRow = {
  id: string
  display_name: string | null
  source_filename: string | null
  metadata: Record<string, unknown> | null
}

/**
 * The newest applied leaderboard import belonging to the running season.
 *
 * Which season a batch belongs to is decided by the season of the teams in it,
 * not by `stat_import_batches.season_id` — that column is NULL on the Google
 * Sheets imports, which are the most recent standings there are. Recency alone
 * is worse: between seasons it kept the previous season's final table on the
 * page as if it were the current standings. Past seasons keep their tables on
 * their own event pages.
 */
async function loadCurrentBatch(activeSeasonId: string | null): Promise<BatchRow | null> {
  if (!activeSeasonId) return null

  const { data: seasonEntries } = await supabaseAdmin
    .from('leaderboard_entries')
    .select('import_batch_id, teams:teams!leaderboard_entries_team_id_fkey!inner (season_id)')
    .eq('teams.season_id', activeSeasonId)
    .not('import_batch_id', 'is', null)

  const candidateIds = Array.from(
    new Set((seasonEntries ?? []).map((entry) => entry.import_batch_id as string))
  )
  if (candidateIds.length === 0) return null

  const { data: batch } = await supabaseAdmin
    .from('stat_import_batches')
    .select('id, display_name, source_filename, created_at, metadata')
    .in('id', candidateIds)
    .filter('metadata->>import_type', 'eq', 'leaderboard_entries')
    .eq('status', 'applied')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (batch as BatchRow | null) ?? null
}

/**
 * Standings plus the season's team directory. These were two pages that showed
 * overlapping data; a team the season has appears whether or not the standings
 * have recorded a result for it yet.
 *
 * The whole page belongs to the running season. Between seasons there is
 * nothing current to show — not the last season's table and not its teams —
 * and the page says so instead. Past seasons keep their standings and rosters
 * on their own event pages.
 */
async function loadStandings() {
  const { data: activeSeason } = await supabaseAdmin
    .from('seasons')
    .select('id, name')
    .eq('is_active', true)
    .maybeSingle()

  const activeSeasonId = (activeSeason?.id as string | undefined) ?? null

  if (!activeSeasonId) {
    return {
      rows: [] as StandingsRow[],
      seeds: {} as SeedMap,
      season: null,
      batch: null,
    }
  }

  // The batch, the team directory and the bracket seeds are independent of one
  // another; only the entries query needs to wait on them.
  const [batch, { data: teams }, seeds] = await Promise.all([
    loadCurrentBatch(activeSeasonId),
    supabaseAdmin
      .from('teams')
      .select('id, name, tag, logo_path, metadata')
      .eq('season_id', activeSeasonId)
      .eq('approval_status', 'approved')
      .order('name', { ascending: true }),
    // Seeds come from the active season's bracket, matching the team list.
    getSeasonSeeds(activeSeasonId),
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
        : /*
           * Before the season's first import there is nothing to be outside of,
           * so every team joins the table at zero rather than being listed as
           * missing from standings that do not exist yet. Once an import lands,
           * a team absent from it really is outside the standings.
           */
          batch
          ? null
          : ZEROED_STATS,
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
    season: { id: activeSeasonId, name: (activeSeason?.name as string | undefined) ?? null },
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
    season: standings.season,
    myTeam,
    viewer: { isAdmin: locals.user?.role === 'admin' },
  }
}
