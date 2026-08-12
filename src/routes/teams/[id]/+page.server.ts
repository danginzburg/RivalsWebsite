import { error } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { getSeasonSeeds } from '$lib/server/seasons/seeds'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type ProfileRow = {
  id: string
  display_name?: string | null
  email?: string | null
  riot_id_base?: string | null
}

type MembershipRow = {
  profile_id?: string | null
  player_name?: string | null
  role?: string | null
}

type RosterStatRow = {
  profile_id?: string | null
  player_name?: string | null
  acs?: number | null
  kd?: number | null
  adr?: number | null
  games?: number | null
}

type StatsBatchRow = {
  id: string
  season_id?: string | null
  import_kind?: string | null
  display_name?: string | null
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

  const { data: membershipRows, error: membershipError } = await supabaseAdmin
    .from('team_memberships')
    .select('profile_id, player_name, role')
    .eq('team_id', teamId)
    .eq('is_active', true)
    .is('left_at', null)

  if (membershipError) throw error(500, 'Failed to load team roster')

  const profileIds = Array.from(
    new Set(
      (membershipRows ?? []).map((m) => m.profile_id).filter((id): id is string => Boolean(id))
    )
  )
  const profileById = new Map<string, ProfileRow>()
  if (profileIds.length > 0) {
    const { data: profileRows } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, email, riot_id_base')
      .in('id', profileIds)
    for (const p of profileRows ?? []) profileById.set(p.id, p)
  }

  const roster = ((membershipRows ?? []) as MembershipRow[]).map((m) => {
    const p = profileById.get(m.profile_id ?? '')
    return {
      profile_id: m.profile_id,
      player_name: m.player_name ?? null,
      riot_id_base: p?.riot_id_base ?? null,
      role: m.role ?? 'player',
      display_name: p?.display_name ?? null,
      email: p?.email ?? null,
    }
  })

  const { data: matchHistory } = await supabaseAdmin
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
    .limit(20)

  const { data: upcomingMatches } = await supabaseAdmin
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
    .limit(10)

  const { data: leaderboardBatch } = await supabaseAdmin
    .from('stat_import_batches')
    .select('id, display_name, created_at, metadata')
    .filter('metadata->>import_type', 'eq', 'leaderboard_entries')
    .eq('status', 'applied')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: activeSeason } = await supabaseAdmin
    .from('seasons')
    .select('id, name, code')
    .eq('is_active', true)
    .maybeSingle()

  const { data: leaderboardEntry } = leaderboardBatch
    ? await supabaseAdmin
        .from('leaderboard_entries')
        .select('rank, points, matches_played, wins, losses, map_wins, map_losses, round_diff')
        .eq('import_batch_id', leaderboardBatch.id)
        .eq('team_id', teamId)
        .maybeSingle()
    : { data: null }

  const { data: statsBatches } = await supabaseAdmin
    .from('stat_import_batches')
    .select('id, season_id, import_kind, display_name, created_at, metadata')
    .filter('metadata->>import_type', 'eq', 'rivals_group_stats')
    .eq('status', 'applied')
    .order('created_at', { ascending: false })
    .limit(50)

  // Aggregate imports are not reliably tagged with a season — in practice every
  // row carries season_id null — so a season match cannot be required or the
  // roster would never show a stat. Prefer a tagged batch when one exists.
  const aggregateBatches = ((statsBatches ?? []) as StatsBatchRow[]).filter(
    (batch) => batch.import_kind === 'aggregate'
  )
  const taggedBatch = activeSeason?.id
    ? aggregateBatches.find((batch) => batch.season_id === activeSeason.id)
    : undefined

  // Otherwise pick the import that covers the most of this roster. Recency
  // alone picks whichever sub-event was imported last (a playoff-only file, say),
  // which leaves most of the roster blank.
  const candidateIds = taggedBatch
    ? [taggedBatch.id]
    : aggregateBatches.slice(0, 12).map((batch) => batch.id)

  const { data: candidateStats } =
    candidateIds.length > 0 && profileIds.length > 0
      ? await supabaseAdmin
          .from('rivals_group_stats')
          .select('import_batch_id, profile_id, player_name, acs, kd, adr, games')
          .in('import_batch_id', candidateIds)
          .in('profile_id', profileIds)
      : { data: [] }

  const rowsByBatch = new Map<string, RosterStatRow[]>()
  for (const row of (candidateStats ?? []) as Array<RosterStatRow & { import_batch_id: string }>) {
    const list = rowsByBatch.get(row.import_batch_id)
    if (list) list.push(row)
    else rowsByBatch.set(row.import_batch_id, [row])
  }

  // `candidateIds` is newest-first, so a tie resolves to the more recent import.
  let currentSeasonStatsBatchId: string | null = null
  let bestCoverage = 0
  for (const id of candidateIds) {
    const coverage = rowsByBatch.get(id)?.length ?? 0
    if (coverage > bestCoverage) {
      bestCoverage = coverage
      currentSeasonStatsBatchId = id
    }
  }

  const statsByProfileId = new Map<string, RosterStatRow>()
  for (const row of rowsByBatch.get(currentSeasonStatsBatchId ?? '') ?? []) {
    if (row.profile_id) statsByProfileId.set(row.profile_id, row)
  }

  const statsBatch = aggregateBatches.find((batch) => batch.id === currentSeasonStatsBatchId)

  // Seed comes from the bracket of the season this team belongs to.
  const teamSeeds = await getSeasonSeeds((team as { season_id?: string | null }).season_id)

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
    roster: roster.map((player) => ({
      ...player,
      stats: statsByProfileId.get(player.profile_id ?? '') ?? null,
    })),
    seeds: teamSeeds,
    matchHistory: withTeamLogos(matchHistory ?? []),
    upcomingMatches: withTeamLogos(upcomingMatches ?? []),
    activeSeason: activeSeason ?? null,
    /** Which import the roster numbers came from, so the page can say so. */
    statsBatchName: statsBatch?.display_name ?? null,
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
