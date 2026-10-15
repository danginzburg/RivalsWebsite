import { error } from '@sveltejs/kit'
import { pickStandingsBatch } from '$lib/server/leaderboard/batch'
import { supabaseAdmin } from '$lib/supabase/admin'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { getSeasonSeeds } from '$lib/server/seasons/seeds'
import { isShortStint } from '$lib/server/matches/subs'
import {
  aggregateRoster,
  resolveSeasonStatBatchIds,
  type SeasonStatRow,
} from '$lib/server/stats/season-batches'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type ProfileRow = {
  id: string
  display_name?: string | null
  email?: string | null
  riot_id_base?: string | null
  stats_player_name?: string | null
}

type MembershipRow = {
  id: number
  profile_id?: string | null
  player_name?: string | null
  role?: string | null
  joined_at?: string | null
  left_at?: string | null
  is_active?: boolean | null
  metadata?: { hidden_from_history?: boolean } | null
}

export const load = async ({ params, locals }: { params: { id: string }; locals: App.Locals }) => {
  const teamId = params.id
  if (!UUID_RE.test(teamId)) throw error(404, 'Team not found')

  const viewerRole = locals.user?.role ?? null
  const isAdmin = viewerRole === 'admin'

  const { data: team, error: teamError } = await supabaseAdmin
    .from('teams')
    .select('id, name, tag, logo_path, approval_status, status, metadata, created_at, season_id')
    .eq('id', teamId)
    .maybeSingle()

  if (teamError || !team) throw error(404, 'Team not found')
  if (!isAdmin && team.approval_status !== 'approved') throw error(404, 'Team not found')

  const teamSeasonIdRaw = (team as { season_id?: string | null }).season_id ?? null

  /*
   * Everything below depends only on the team, so it goes out in one round
   * trip rather than six. The loader used to await thirteen queries in series;
   * the remaining `await`s are genuine dependency waits.
   */
  const [
    { data: membershipRows, error: membershipError },
    { data: matchHistory },
    { data: upcomingMatches },
    { data: leaderboardBatches },
    { data: activeSeason },
    teamSeeds,
  ] = await Promise.all([
    supabaseAdmin
      .from('team_memberships')
      .select('id, profile_id, player_name, role, joined_at, left_at, is_active, metadata')
      .eq('team_id', teamId)
      // Closed stints too: they are the players who left this team mid-event.
      .or('is_active.eq.true,left_at.not.is.null')
      .order('left_at', { ascending: false, nullsFirst: true }),
    supabaseAdmin
      .from('matches')
      .select(
        `
      id,
      status,
      approval_status,
      scheduled_at,
      ended_at,
      team_a_id,
      team_b_id,
      team_a_score,
      team_b_score,
      winner_team_id,
      team_a:teams!matches_team_a_id_fkey (id, name, tag, logo_path),
      team_b:teams!matches_team_b_id_fkey (id, name, tag, logo_path)
    `
      )
      .eq('status', 'completed')
      .eq('approval_status', 'approved')
      .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
      .order('scheduled_at', { ascending: false })
      .limit(20),
    supabaseAdmin
      .from('matches')
      .select(
        `
      id,
      status,
      approval_status,
      scheduled_at,
      team_a_id,
      team_b_id,
      team_a_score,
      team_b_score,
      team_a:teams!matches_team_a_id_fkey (id, name, tag, logo_path),
      team_b:teams!matches_team_b_id_fkey (id, name, tag, logo_path)
    `
      )
      .in('status', ['scheduled', 'live'])
      .eq('approval_status', 'approved')
      .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
      .order('scheduled_at', { ascending: true })
      .limit(10),
    supabaseAdmin
      .from('stat_import_batches')
      .select('id, season_id, display_name, created_at, metadata')
      .filter('metadata->>import_type', 'eq', 'leaderboard_entries')
      .eq('status', 'applied')
      .order('created_at', { ascending: false })
      .limit(50),
    supabaseAdmin.from('seasons').select('id, name, code').eq('is_active', true).maybeSingle(),
    // Seed comes from the bracket of the season this team belongs to.
    getSeasonSeeds(teamSeasonIdRaw),
  ])

  if (membershipError) throw error(500, 'Failed to load team roster')

  // The team's season's calculated standings when it has them; otherwise the
  // newest import, as before.
  const batchList = leaderboardBatches ?? []
  const leaderboardBatch =
    pickStandingsBatch(batchList.filter((b) => b.season_id === teamSeasonIdRaw)) ??
    batchList[0] ??
    null

  const profileIds = Array.from(
    new Set(
      (membershipRows ?? []).map((m) => m.profile_id).filter((id): id is string => Boolean(id))
    )
  )

  // Roster numbers always describe the active season, regardless of which
  // season the team itself belongs to. (Bracket seeds above still use the
  // team's own season.)
  const statsSeasonId = activeSeason?.id ?? null

  const [{ data: profileRows }, { data: leaderboardEntry }, { data: statsSeason }] =
    await Promise.all([
      profileIds.length > 0
        ? supabaseAdmin
            .from('profiles')
            .select('id, display_name, email, riot_id_base, stats_player_name')
            .in('id', profileIds)
        : Promise.resolve({ data: [] as ProfileRow[] }),
      leaderboardBatch
        ? supabaseAdmin
            .from('leaderboard_entries')
            .select('rank, points, matches_played, wins, losses, map_wins, map_losses, round_diff')
            .eq('import_batch_id', leaderboardBatch.id)
            .eq('team_id', teamId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      statsSeasonId
        ? supabaseAdmin
            .from('seasons')
            .select('id, name, code, metadata')
            .eq('id', statsSeasonId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ])

  const profileById = new Map<string, ProfileRow>()
  for (const p of profileRows ?? []) profileById.set(p.id, p)

  const toPlayer = (m: MembershipRow) => {
    const p = profileById.get(m.profile_id ?? '')
    return {
      profile_id: m.profile_id,
      player_name: m.player_name ?? null,
      riot_id_base: p?.riot_id_base ?? null,
      role: m.role ?? 'player',
      display_name: p?.display_name ?? null,
      email: p?.email ?? null,
    }
  }

  const memberships = (membershipRows ?? []) as MembershipRow[]
  const openMemberships = memberships.filter((m) => m.is_active && !m.left_at)
  const roster = openMemberships.map(toPlayer)

  // Players who left this team: one row each, at their latest departure. A
  // closed row for someone still on the roster is a retired duplicate slot,
  // and one closed within a day of opening is a mis-entry; neither is a departure.
  // An admin can also hide an entry (a player entered twice under another name);
  // `membership_ids` carries every closed stint folded into the row so hiding
  // it hides them all, and hidden entries still reach admins to be restored.
  const memberKey = (m: MembershipRow) =>
    m.profile_id ? `p:${m.profile_id}` : `n:${(m.player_name ?? '').trim().toLowerCase()}`
  const onRoster = new Set(openMemberships.map(memberKey))
  type FormerPlayer = ReturnType<typeof toPlayer> & {
    joined_at: string | null
    left_at: string
    membership_ids: number[]
    hidden: boolean
  }
  const formerByKey = new Map<string, FormerPlayer>()
  for (const m of memberships) {
    const key = memberKey(m)
    if (!m.left_at || isShortStint(m.joined_at, m.left_at) || onRoster.has(key)) continue
    const existing = formerByKey.get(key)
    if (existing) {
      existing.membership_ids.push(m.id)
      existing.hidden &&= Boolean(m.metadata?.hidden_from_history)
      continue
    }
    formerByKey.set(key, {
      ...toPlayer(m),
      joined_at: m.joined_at ?? null,
      left_at: m.left_at,
      membership_ids: [m.id],
      hidden: Boolean(m.metadata?.hidden_from_history),
    })
  }
  const formerPlayers = [...formerByKey.values()].filter((p) => isAdmin || !p.hidden)

  // Every event of the active season — for Season 4 that is Kickoff, the regular
  // season, play-ins and playoffs — summed into one line per player. The curated
  // list (or a season's `metadata.stat_batches` override) wins when present.
  let seasonBatchIds = resolveSeasonStatBatchIds(statsSeason)

  // A season with no curated list (a newer one run off auto-generated match
  // batches, say) falls back to every generated stats batch scoped to *this*
  // season. Generated batches carry a real `season_id`; CSV imports leave it
  // NULL, so this stays inside the active season instead of borrowing another
  // season's numbers the way the old coverage-based fallback did.
  if (seasonBatchIds.length === 0 && statsSeasonId) {
    const { data: seasonBatches } = await supabaseAdmin
      .from('stat_import_batches')
      .select('id')
      .filter('metadata->>import_type', 'eq', 'rivals_group_stats')
      .eq('season_id', statsSeasonId)
      .eq('status', 'applied')
      .gt('row_count', 0)

    seasonBatchIds = ((seasonBatches ?? []) as Array<{ id: string }>).map((b) => b.id)
  }

  const [{ data: seasonStatRows }, { data: seasonBatchRows }] = await Promise.all([
    seasonBatchIds.length > 0
      ? supabaseAdmin
          .from('rivals_group_stats')
          .select('profile_id, player_name, acs, kd, adr, games, rounds, kills, deaths')
          .in('import_batch_id', seasonBatchIds)
      : Promise.resolve({ data: [] as SeasonStatRow[] }),
    seasonBatchIds.length > 0
      ? supabaseAdmin
          .from('stat_import_batches')
          .select('id, display_name, sort_order')
          // `sort_order` counts down from the newest import, so descending
          // lists the events in the order they were played.
          .in('id', seasonBatchIds)
          .order('sort_order', { ascending: false, nullsFirst: false })
      : Promise.resolve({ data: [] as Array<{ display_name: string | null }> }),
  ])

  const statsSources = (seasonBatchRows ?? [])
    .map((batch) => batch.display_name)
    .filter((name): name is string => Boolean(name))

  // Match rows to the roster by profile, then by any alias the player is known
  // by — most pre-claim imports have a NULL profile_id.
  const rosterStats = aggregateRoster(
    roster.map((player) => ({
      profile_id: player.profile_id,
      names: [
        player.player_name,
        player.riot_id_base,
        profileById.get(player.profile_id ?? '')?.stats_player_name,
      ],
    })),
    (seasonStatRows ?? []) as SeasonStatRow[]
  )

  type MatchTeamRel = { id: string; name: string; tag: string | null; logo_path?: string | null }

  /** Flatten the embedded team rows and resolve their logo URLs. */
  const withTeamLogos = <T extends { team_a?: unknown; team_b?: unknown }>(rows: T[]) =>
    rows.map((row) => {
      const side = (value: unknown) => {
        const rel = (Array.isArray(value) ? value[0] : value) as MatchTeamRel | null | undefined
        return rel ? { ...rel, logo_url: getTeamLogoUrl(rel) } : null
      }
      return { ...row, team_a: side(row.team_a), team_b: side(row.team_b) }
    })

  return {
    team: {
      id: team.id,
      name: team.name,
      tag: team.tag ?? null,
      logo_url: getTeamLogoUrl(team),
      status: team.status,
      org: team.metadata?.org ?? null,
      about: team.metadata?.about ?? null,
      created_at: team.created_at,
    },
    seed: teamSeeds[team.id] ?? null,
    roster: roster.map((player, index) => ({
      ...player,
      stats: rosterStats[index],
    })),
    formerPlayers,
    seeds: teamSeeds,
    matchHistory: withTeamLogos(matchHistory ?? []),
    upcomingMatches: withTeamLogos(upcomingMatches ?? []),
    activeSeason: activeSeason ?? null,
    /** The season the roster numbers cover, so the page can say so. */
    statsSeasonName: statsSeason?.name ?? null,
    /** Every event folded into those numbers, for the card's tooltip. */
    statsSources,
    leaderboard: leaderboardEntry
      ? {
          ...leaderboardEntry,
          batch: {
            display_name: leaderboardBatch?.display_name ?? null,
            as_of_date: leaderboardBatch?.metadata?.as_of_date ?? null,
          },
        }
      : null,
    viewer: { isAdmin },
  }
}
