import { error, redirect } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { claimRelinkAfterProfileUpdate } from '$lib/server/players/claim-relink'
import { normalizeRiotBase, isValidRiotBase } from '$lib/server/riot-id'
import { supabaseErrorMessageIncludes } from '$lib/server/supabase/errors'
import { toBatchLabel } from '$lib/server/stats/batch-label'
import { average, sum, weightedAverage } from '$lib/server/math'
import {
  extractNumericLabel,
  isLatestLabel,
  normalizeRivalsGroupStatBatchFromDb,
  type NormalizedRivalsGroupStatBatch,
  type StatImportBatchRow,
} from '$lib/server/stats/rivals-batch'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { rematchPlayerMatchMapStatsForBase } from '$lib/server/imports/matching'
import { rankValue } from '$lib/ranks/ranks'
import { loadCommentThread } from '$lib/server/comments'
import { getViewerProfileId } from '$lib/server/auth/viewer'
import { listRiotAccounts, syncPrimaryRiotName } from '$lib/server/players/riot-accounts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type ProfileRow = {
  auth0_sub?: string | null
  stats_player_name?: string | null
}

type TeamRel = {
  id: string
  name: string
  tag?: string | null
  logo_path?: string | null
  approval_status?: string | null
}

type SeasonRel = {
  id: string
  name?: string | null
  code?: string | null
  starts_on?: string | null
}

type MembershipTeamRel = TeamRel & {
  season_id?: string | null
  seasons?: SeasonRel | SeasonRel[] | null
}

type TeamHistoryRow = {
  /** Team id doubles as the key — one row per team, however many stints. */
  team: { id: string; name: string; tag: string | null; logo_url: string | null }
  season: { name: string; code: string | null } | null
  role: string | null
  joined_at: string | null
  /** Sort key: when this team's season began, empty for an unassigned team. */
  season_started_on: string
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
 * The list makes no current-versus-former distinction. Rosters are season-scoped,
 * so a backfilled past season leaves its memberships open indefinitely and an
 * open membership says nothing about where the player is today; the season column
 * carries that information instead.
 */
async function loadTeamHistory(profileId: string): Promise<TeamHistoryRow[]> {
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
        seasons!teams_season_id_fkey (id, name, code, starts_on)
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
  for (const row of (data ?? []) as Row[]) {
    const team = Array.isArray(row.teams) ? row.teams[0] : row.teams
    if (!team || team.approval_status !== 'approved') continue

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
      continue
    }

    byTeam.set(team.id, {
      team: {
        id: team.id,
        name: team.name,
        tag: team.tag ?? null,
        logo_url: getTeamLogoUrl(team),
      },
      season: seasonRel ? { name: seasonRel.name ?? 'Season', code: seasonRel.code ?? null } : null,
      role: row.role ?? null,
      joined_at: row.joined_at ?? null,
      season_started_on: seasonRel?.starts_on ?? '',
    })
  }

  // Newest season first; within a season, the most recent roster first.
  return [...byTeam.values()].sort((a, b) => {
    if (a.season_started_on !== b.season_started_on) {
      return b.season_started_on.localeCompare(a.season_started_on)
    }
    return (b.joined_at ?? '').localeCompare(a.joined_at ?? '')
  })
}

type StatBatchInfo = Partial<NormalizedRivalsGroupStatBatch> & { id: string; display_name: string }

type StatRow = {
  import_batch_id: string
  imported_at?: string | null
  [key: string]: unknown
}

type NormalizedStatRow = StatRow & { batch: StatBatchInfo }

type TeamLite = {
  id: string
  name: string
  tag?: string | null
  logo_path?: string | null
  logo_url?: string | null
}

type MatchRel = {
  id: string
  status?: string | null
  approval_status?: string | null
  scheduled_at?: string | null
  ended_at?: string | null
  team_a_id?: string | null
  team_b_id?: string | null
  team_a_score?: number | null
  team_b_score?: number | null
  winner_team_id?: string | null
  team_a?: TeamLite | TeamLite[] | null
  team_b?: TeamLite | TeamLite[] | null
}

type ParticipatedRow = {
  id?: string | number | null
  match_id?: string | null
  profile_id?: string | null
  player_name?: string | null
  team_id?: string | null
  agents?: string | null
  acs?: number | null
  kills?: number | null
  deaths?: number | null
  assists?: number | null
  kd?: number | null
  adr?: number | null
  kast_pct?: number | null
  hs_pct?: number | null
  matches?: MatchRel | MatchRel[] | null
}

type MatchHistoryEntry = {
  match: MatchRel | null
  team_id: string | null
  opponent: TeamLite | null
  score: { us: number; them: number }
  agents: string | null
  acs: number | null
  kills: number | null
  deaths: number | null
  assists: number | null
  kd: number | null
  adr: number | null
  kast_pct: number | null
  hs_pct: number | null
}

type AggregatedStatEntry = {
  key: string
  maps_played: number
  maps_won: number
  /** Maps with a determinable winner — the denominator behind win_pct. */
  maps_decided: number
  win_pct: number | null
  rounds: number
  acs: number | null
  kills: number
  deaths: number
  assists: number
  kd: number | null
  adr: number | null
  kast_pct: number | null
  hs_pct: number | null
  fk: number
  fd: number
}

type PerMapStatRow = {
  team_id: string | null
  agents: string | null
  acs: number | null
  kills: number | null
  deaths: number | null
  assists: number | null
  kd: number | null
  adr: number | null
  kast_pct: number | null
  hs_pct: number | null
  rounds: number | null
  fk: number | null
  fd: number | null
  plants: number | null
  defuses: number | null
  match_maps: {
    map_name: string | null
    is_voided: boolean
    team_a_rounds: number | null
    team_b_rounds: number | null
    matches: { team_a_id: string | null; team_b_id: string | null } | null
  } | null
}

function didWinMap(row: PerMapStatRow): boolean | null {
  const mm = Array.isArray(row.match_maps) ? row.match_maps[0] : row.match_maps
  if (!mm || !row.team_id) return null
  const match = Array.isArray(mm.matches) ? mm.matches[0] : mm.matches
  if (!match) return null

  // The player's team must be one of the two sides. Without this guard a row
  // whose team_id matches neither (a re-linked roster, a bad import) falls
  // through to the team-B branch and is scored against the wrong side.
  const isTeamA = row.team_id === match.team_a_id
  const isTeamB = row.team_id === match.team_b_id
  if (!isTeamA && !isTeamB) return null

  const aRounds = mm.team_a_rounds ?? 0
  const bRounds = mm.team_b_rounds ?? 0
  if (aRounds === bRounds) return null

  return isTeamA ? aRounds > bRounds : bRounds > aRounds
}

function aggregateStats(rows: PerMapStatRow[]): Omit<AggregatedStatEntry, 'key'> {
  const totalKills = sum(rows.map((r) => r.kills))
  const totalDeaths = sum(rows.map((r) => r.deaths))

  // Evaluate each row once — didWinMap walks joined rows and was previously
  // called twice per row per aggregate.
  const outcomes = rows.map(didWinMap)
  const wins = outcomes.filter((o) => o === true).length
  // Maps with no determinable result are excluded from the percentage rather
  // than counted as losses, so `maps_decided` is the honest denominator.
  const decided = outcomes.filter((o) => o !== null).length

  return {
    maps_played: rows.length,
    maps_won: wins,
    maps_decided: decided,
    win_pct: decided > 0 ? (wins / decided) * 100 : null,
    rounds: sum(rows.map((r) => r.rounds)),
    acs: average(rows.map((r) => r.acs)),
    kills: totalKills,
    deaths: totalDeaths,
    assists: sum(rows.map((r) => r.assists)),
    kd: totalDeaths > 0 ? totalKills / totalDeaths : null,
    adr: weightedAverage(
      rows.map((r) => ({ adr: r.adr, rounds: r.rounds })),
      'adr',
      'rounds'
    ),
    kast_pct: weightedAverage(
      rows.map((r) => ({ kast_pct: r.kast_pct, rounds: r.rounds })),
      'kast_pct',
      'rounds'
    ),
    hs_pct: average(rows.map((r) => r.hs_pct)),
    fk: sum(rows.map((r) => r.fk)),
    fd: sum(rows.map((r) => r.fd)),
  }
}

function kindOrder(kind: unknown): number {
  return kind === 'aggregate' ? 0 : kind === 'weekly' ? 1 : 2
}

function normalizeNameBase(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  return raw.split('#')[0].trim()
}

function quoteOrValue(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

export const load = async ({
  params,
  url,
  locals,
}: {
  params: { id: string }
  url: URL
  locals: App.Locals
}) => {
  const profileId = params.id
  if (!UUID_RE.test(profileId)) throw error(404, 'Player not found')

  const selectedBatchId = url.searchParams.get('batchId')

  const { data: profileRel, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, auth0_sub, role, display_name, email, riot_id_base, stats_player_name, created_at')
    .eq('id', profileId)
    .maybeSingle()

  if (profileError) {
    const msg = String((profileError as { message?: string }).message ?? '')
    if (supabaseErrorMessageIncludes(profileError, 'riot_id_base')) {
      throw error(500, 'Database missing profiles.riot_id_base; apply the Supabase migration')
    }
    throw error(500, msg || 'Failed to load player')
  }

  if (!profileRel) throw error(404, 'Player not found')

  // Viewer permissions for inline Riot ID setup.
  let canEditRiotIdBase = false
  if (locals.user) {
    if (
      (profileRel as ProfileRow).auth0_sub &&
      (profileRel as ProfileRow).auth0_sub === locals.user.sub
    ) {
      canEditRiotIdBase = true
    } else {
      const { data: viewer } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('auth0_sub', locals.user.sub)
        .maybeSingle()
      canEditRiotIdBase = viewer?.role === 'admin'
    }
  }

  // Current roster spot, every past roster spot, and the aggregate stat rows
  // all key off the profile alone, so they go out together.
  const [
    { data: membershipRows },
    { data: activeSeason },
    teamHistory,
    { data: approvedSignup },
    { data: statsRows },
  ] = await Promise.all([
    // Rosters are exclusive per season, so a player who has been backfilled into
    // past seasons carries several active memberships at once. The header wants
    // the current-season one; the rest belong to the history table below.
    supabaseAdmin
      .from('team_memberships')
      .select(
        `
      team_id,
      role,
      season_id,
      teams (id, name, tag, logo_path, approval_status)
    `
      )
      .eq('profile_id', profileId)
      .eq('is_active', true)
      .is('left_at', null),
    supabaseAdmin.from('seasons').select('id').eq('is_active', true).maybeSingle(),
    loadTeamHistory(profileId),
    // Contact details come from the approved signup itself rather than the
    // copy on `profiles`. That copy is written on approval and retracted on
    // rejection, so any path that leaves a signup non-approved without going
    // through the admin endpoint strands it — which is how pending players
    // ended up publishing a Discord handle.
    supabaseAdmin
      .from('player_signups')
      .select('discord_handle, tracker_links, updated_at')
      .eq('profile_id', profileId)
      .eq('status', 'approved')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('rivals_group_stats')
      .select(
        'id, player_name, profile_id, agents, games, games_won, games_lost, rounds, rounds_won, rounds_lost, acs, kd, kast_pct, adr, kills, deaths, assists, fk, fd, hs_pct, econ_rating, kpg, kpr, dpg, dpr, apg, apr, fkpg, fdpg, plants, plants_per_game, defuses, defuses_per_game, league_rank, import_batch_id, imported_at'
      )
      .eq('profile_id', profileId)
      .order('imported_at', { ascending: false })
      .limit(200),
  ])

  type ActiveMembershipRow = {
    role?: string | null
    season_id?: string | null
    teams?: TeamRel | TeamRel[] | null
  }

  // Only the active season's spot counts as the player's team right now. Open
  // memberships in backfilled past seasons are history, and with no active
  // season configured there is no current team at all.
  const currentSeasonId = (activeSeason?.id as string | undefined) ?? null
  const membership = currentSeasonId
    ? (((membershipRows ?? []) as ActiveMembershipRow[]).find(
        (row) => row.season_id === currentSeasonId
      ) ?? null)
    : null

  const membershipTeams = membership?.teams
  const teamRel = membership
    ? Array.isArray(membershipTeams)
      ? membershipTeams[0]
      : membershipTeams
    : null

  const activeTeam =
    teamRel?.approval_status === 'approved'
      ? {
          id: teamRel.id,
          name: teamRel.name,
          tag: teamRel.tag ?? null,
          logo_url: getTeamLogoUrl(teamRel),
          role: membership?.role ?? null,
        }
      : null

  const possibleUnmatchedNames = Array.from(
    new Set(
      [
        profileRel.display_name,
        profileRel.riot_id_base,
        (profileRel as ProfileRow).stats_player_name,
      ]
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
    )
  )

  const unmatchedChecks = await Promise.all(
    possibleUnmatchedNames.map((playerName) =>
      supabaseAdmin
        .from('rivals_group_stats')
        .select('id', { count: 'exact', head: true })
        .is('profile_id', null)
        .ilike('player_name', playerName)
    )
  )

  const hasUnmatchedStatsCandidate = unmatchedChecks.some((result) => Number(result.count ?? 0) > 0)

  const batchIds = Array.from(
    new Set(((statsRows ?? []) as StatRow[]).map((r) => r.import_batch_id).filter(Boolean))
  )

  const { data: batches } = batchIds.length
    ? await supabaseAdmin
        .from('stat_import_batches')
        .select(
          'id, display_name, source_filename, import_kind, week_label, created_at, metadata, sort_order'
        )
        .in('id', batchIds)
        .order('created_at', { ascending: false })
    : { data: [] }

  const batchById = new Map<string, NormalizedRivalsGroupStatBatch>()
  for (const b of batches ?? []) {
    batchById.set(
      b.id,
      normalizeRivalsGroupStatBatchFromDb(b as StatImportBatchRow, {
        displayNameFallback: 'source_filename',
      })
    )
  }

  const batchOptions = Array.from(batchById.values())
    .sort((a, b) => {
      const ka = kindOrder(a.import_kind)
      const kb = kindOrder(b.import_kind)
      if (ka !== kb) return ka - kb

      const ao = a.sort_order
      const bo = b.sort_order
      if (typeof ao === 'number' && typeof bo === 'number' && ao !== bo) return ao - bo
      if (typeof ao === 'number' && typeof bo !== 'number') return -1
      if (typeof ao !== 'number' && typeof bo === 'number') return 1

      const ta = a.created_at ? new Date(a.created_at).getTime() : 0
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0
      if (ta !== tb) return tb - ta

      return toBatchLabel(a).localeCompare(toBatchLabel(b))
    })
    .map((b) => ({
      label: toBatchLabel(b),
      value: b.id,
      import_kind: b.import_kind ?? null,
      week_label: b.week_label ?? null,
    }))

  const normalizedStats: NormalizedStatRow[] = ((statsRows ?? []) as StatRow[]).map((r) => ({
    ...r,
    batch: batchById.get(r.import_batch_id) ?? {
      id: r.import_batch_id,
      display_name: r.import_batch_id,
    },
  }))

  let selected: NormalizedStatRow | null = null
  if (selectedBatchId) {
    selected = normalizedStats.find((r) => r.import_batch_id === selectedBatchId) ?? null
  }

  if (!selected) {
    const byBatchId = new Map<string, NormalizedStatRow>()
    for (const r of normalizedStats) {
      if (!r.import_batch_id) continue
      if (byBatchId.has(r.import_batch_id)) continue
      byBatchId.set(r.import_batch_id, r)
    }

    const aggregates = Array.from(byBatchId.values()).filter(
      (r) => r.batch?.import_kind === 'aggregate'
    )
    const weeklies = Array.from(byBatchId.values()).filter((r) => r.batch?.import_kind === 'weekly')

    function sortBatches(a: NormalizedStatRow, b: NormalizedStatRow) {
      const ao = a.batch?.sort_order
      const bo = b.batch?.sort_order
      if (typeof ao === 'number' && typeof bo === 'number' && ao !== bo) return ao - bo
      if (typeof ao === 'number' && typeof bo !== 'number') return -1
      if (typeof ao !== 'number' && typeof bo === 'number') return 1

      const aName = a.batch?.display_name ?? ''
      const bName = b.batch?.display_name ?? ''

      const aLatest = isLatestLabel(aName)
      const bLatest = isLatestLabel(bName)
      if (aLatest !== bLatest) return aLatest ? -1 : 1

      const na = extractNumericLabel(aName)
      const nb = extractNumericLabel(bName)
      if (na !== null && nb !== null && na !== nb) return nb - na

      // When either side lacks a numeric label, fall back to time ordering instead of
      // always preferring the numeric-labeled batch.
      const ta = a.batch?.created_at ? new Date(a.batch.created_at).getTime() : 0
      const tb = b.batch?.created_at ? new Date(b.batch.created_at).getTime() : 0
      if (ta !== tb) return tb - ta

      const ia = a.imported_at ? new Date(a.imported_at).getTime() : 0
      const ib = b.imported_at ? new Date(b.imported_at).getTime() : 0
      if (ia !== ib) return ib - ia

      return String(aName).localeCompare(String(bName))
    }

    aggregates.sort(sortBatches)
    weeklies.sort(sortBatches)

    selected = aggregates[0] ?? weeklies[0] ?? normalizedStats[0] ?? null
  }

  const matchMapStatsSelect = `
      id,
      match_id,
      profile_id,
      player_name,
      team_id,
      agents,
      acs,
      kills,
      deaths,
      assists,
      kd,
      adr,
      kast_pct,
      hs_pct,
      matches (
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
      )
    `

  const importNameFilters = Array.from(
    new Set(
      [
        profileRel.display_name,
        profileRel.riot_id_base,
        (profileRel as ProfileRow).stats_player_name,
      ]
        .flatMap((name) => {
          const raw = String(name ?? '').trim()
          const base = normalizeNameBase(raw)
          return raw && base ? [raw, base, `${base}#%`] : []
        })
        .filter(Boolean)
    )
  )

  const perMapSelect =
    'id, team_id, agents, acs, kills, deaths, assists, kd, adr, kast_pct, hs_pct, rounds, fk, fd, plants, defuses, match_maps(map_name, is_voided, team_a_rounds, team_b_rounds, matches(team_a_id, team_b_id))'

  const [
    { data: accoladeAssignments },
    { data: claimedParticipation },
    { data: unmatchedParticipation },
    { data: perMapClaimedStats },
    { data: perMapUnmatchedStats },
  ] = await Promise.all([
    supabaseAdmin
      .from('accolade_assignments')
      .select('accolade_id, context, accolades (id, name, logo_path, icon_key)')
      .eq('profile_id', profileId),
    supabaseAdmin
      .from('player_match_map_stats')
      .select(matchMapStatsSelect)
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(500),
    importNameFilters.length > 0
      ? supabaseAdmin
          .from('player_match_map_stats')
          .select(matchMapStatsSelect)
          .is('profile_id', null)
          .or(
            importNameFilters
              .map((name) =>
                name.endsWith('#%')
                  ? `player_name.ilike.${quoteOrValue(name)}`
                  : `player_name.eq.${quoteOrValue(name)}`
              )
              .join(',')
          )
          .order('created_at', { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [] }),
    supabaseAdmin
      .from('player_match_map_stats')
      .select(perMapSelect)
      .eq('profile_id', profileId)
      .limit(1000),
    importNameFilters.length > 0
      ? supabaseAdmin
          .from('player_match_map_stats')
          .select(perMapSelect)
          .is('profile_id', null)
          .or(
            importNameFilters
              .map((name) =>
                name.endsWith('#%')
                  ? `player_name.ilike.${quoteOrValue(name)}`
                  : `player_name.eq.${quoteOrValue(name)}`
              )
              .join(',')
          )
          .limit(1000)
      : Promise.resolve({ data: [] }),
  ])

  const playerAccolades = (accoladeAssignments ?? []).map((a: any) => {
    const acc = Array.isArray(a.accolades) ? a.accolades[0] : a.accolades
    return {
      id: acc?.id ?? a.accolade_id,
      name: acc?.name ?? 'Accolade',
      icon_key: acc?.icon_key ?? null,
      context: a.context ?? null,
      logo_url: acc?.logo_path
        ? supabaseAdmin.storage.from('team-logos').getPublicUrl(acc.logo_path).data.publicUrl
        : null,
    }
  })

  const seenParticipationIds = new Set<string>()
  const groupedParticipation = new Map<string, ParticipatedRow[]>()
  for (const row of [
    ...((claimedParticipation ?? []) as ParticipatedRow[]),
    ...((unmatchedParticipation ?? []) as ParticipatedRow[]),
  ]) {
    const id = String(row.id ?? '')
    if (!id || seenParticipationIds.has(id)) continue
    seenParticipationIds.add(id)

    const matchRel = Array.isArray(row.matches) ? row.matches[0] : row.matches
    if (!matchRel?.id) continue
    const current = groupedParticipation.get(matchRel.id) ?? []
    current.push(row)
    groupedParticipation.set(matchRel.id, current)
  }

  const matchHistory = Array.from(groupedParticipation.values())
    .map((rows): MatchHistoryEntry => {
      const r = rows[0]
      const matchRel = Array.isArray(r.matches) ? r.matches[0] : r.matches
      const perspectiveTeamId =
        activeTeam &&
        (activeTeam.id === matchRel?.team_a_id || activeTeam.id === matchRel?.team_b_id)
          ? activeTeam.id
          : r.team_id === matchRel?.team_a_id || r.team_id === matchRel?.team_b_id
            ? r.team_id
            : null
      const rawOpponent =
        matchRel?.team_a_id === perspectiveTeamId
          ? matchRel?.team_b
          : matchRel?.team_b_id === perspectiveTeamId
            ? matchRel?.team_a
            : null
      const opponentRel = Array.isArray(rawOpponent)
        ? (rawOpponent[0] ?? null)
        : (rawOpponent ?? null)
      const opponent = opponentRel
        ? { ...opponentRel, logo_url: getTeamLogoUrl(opponentRel) }
        : null
      const score =
        matchRel?.team_a_id === perspectiveTeamId
          ? { us: Number(matchRel?.team_a_score ?? 0), them: Number(matchRel?.team_b_score ?? 0) }
          : matchRel?.team_b_id === perspectiveTeamId
            ? { us: Number(matchRel?.team_b_score ?? 0), them: Number(matchRel?.team_a_score ?? 0) }
            : { us: Number(matchRel?.team_a_score ?? 0), them: Number(matchRel?.team_b_score ?? 0) }
      const agents = Array.from(
        new Set(
          rows
            .flatMap((entry) => String(entry.agents ?? '').split(/\s+/))
            .map((value) => value.trim())
            .filter(Boolean)
        )
      ).join(' ')
      return {
        match: matchRel ?? null,
        team_id: perspectiveTeamId ?? null,
        opponent,
        score,
        agents: agents || null,
        acs: average(rows.map((entry) => entry.acs)),
        kills: sum(rows.map((entry) => entry.kills)),
        deaths: sum(rows.map((entry) => entry.deaths)),
        assists: sum(rows.map((entry) => entry.assists)),
        kd: average(rows.map((entry) => entry.kd)),
        adr: average(rows.map((entry) => entry.adr)),
        kast_pct: average(rows.map((entry) => entry.kast_pct)),
        hs_pct: average(rows.map((entry) => entry.hs_pct)),
      }
    })
    .filter(
      (x): x is MatchHistoryEntry & { match: MatchRel } =>
        Boolean(x.match) && x.match?.approval_status === 'approved'
    )
    .sort((a, b) => {
      const at = a.match.scheduled_at ?? a.match.ended_at ?? ''
      const bt = b.match.scheduled_at ?? b.match.ended_at ?? ''
      return new Date(bt).getTime() - new Date(at).getTime()
    })
    .slice(0, 50)

  const seenPerMapIds = new Set<string>()
  const perMapRawStats: (PerMapStatRow & { id: string })[] = []
  for (const r of [
    ...((perMapClaimedStats ?? []) as unknown as (PerMapStatRow & { id: string })[]),
    ...((perMapUnmatchedStats ?? []) as unknown as (PerMapStatRow & { id: string })[]),
  ]) {
    if (seenPerMapIds.has(r.id)) continue
    seenPerMapIds.add(r.id)
    perMapRawStats.push(r)
  }

  const validMapStats = (perMapRawStats as PerMapStatRow[]).filter((r) => {
    const mm = Array.isArray(r.match_maps) ? r.match_maps[0] : r.match_maps
    return mm && !mm.is_voided && mm.map_name
  })

  const byMap = new Map<string, PerMapStatRow[]>()
  for (const r of validMapStats) {
    const mm = Array.isArray(r.match_maps) ? r.match_maps[0] : r.match_maps
    const mapName = mm?.map_name ?? 'Unknown'
    const arr = byMap.get(mapName) ?? []
    arr.push(r)
    byMap.set(mapName, arr)
  }

  const mapStats: AggregatedStatEntry[] = Array.from(byMap.entries())
    .map(([mapName, rows]) => ({ key: mapName, ...aggregateStats(rows) }))
    .sort((a, b) => b.maps_played - a.maps_played)

  const byAgent = new Map<string, PerMapStatRow[]>()
  for (const r of validMapStats) {
    const agents = String(r.agents ?? '')
      .split(/\s+/)
      .map((a) => a.trim())
      .filter(Boolean)
    for (const agent of agents.length > 0 ? agents : ['Unknown']) {
      const arr = byAgent.get(agent) ?? []
      arr.push(r)
      byAgent.set(agent, arr)
    }
  }

  const agentStats: AggregatedStatEntry[] = Array.from(byAgent.entries())
    .map(([agent, rows]) => ({ key: agent, ...aggregateStats(rows) }))
    .sort((a, b) => b.maps_played - a.maps_played)

  let bestRank: string | null = null
  let bestRankValue = 0
  for (const r of normalizedStats) {
    const raw = r.league_rank as string | null
    if (!raw) continue
    const v = rankValue(raw)
    if (v > bestRankValue) {
      bestRankValue = v
      bestRank = raw
    }
  }

  // Sequential rather than parallel: the thread needs the viewer's profile id
  // to mark which comments they have already voted on.
  const viewerProfileId = await getViewerProfileId(locals.user)
  const playerComments = await loadCommentThread('player', profileId, {
    includeReportCounts: locals.user?.role === 'admin',
    viewerProfileId,
  })

  const riotAccounts = await listRiotAccounts(profileId)

  return {
    player: {
      profile_id: profileId,
      // The chosen display name is authoritative; Riot name and email are only
      // fallbacks for profiles that never set one.
      riot_id: profileRel.display_name ?? profileRel.riot_id_base ?? profileRel.email ?? 'Player',
      riot_id_base: profileRel.riot_id_base ?? null,
      stats_player_name: (profileRel as ProfileRow).stats_player_name ?? null,
      has_unmatched_stats_candidate: hasUnmatchedStatsCandidate,
      rank_label: null,
      rank_value: null,
      pronouns: null,
      // Published from an approved signup; empty until then.
      discord_handle:
        (approvedSignup as { discord_handle?: string | null } | null)?.discord_handle ?? null,
      tracker_links: ((
        approvedSignup as {
          tracker_links?: Array<{ label: string; url: string }> | null
        } | null
      )?.tracker_links ?? []) as Array<{ label: string; url: string }>,
      display_name: profileRel?.display_name ?? null,
      email: profileRel?.email ?? null,
      created_at: profileRel?.created_at ?? null,
    },
    bestRank,
    activeTeam,
    teamHistory,
    accolades: playerAccolades,
    riotAccounts,
    viewer: {
      canEditRiotIdBase,
      profileId: viewerProfileId,
      isAdmin: locals.user?.role === 'admin',
    },
    comments: playerComments,
    stats: {
      rows: normalizedStats,
      selected,
      selectedBatchId: selected?.import_batch_id ?? null,
      batchOptions,
    },
    matchHistory,
    mapStats,
    agentStats,
  }
}

export const actions = {
  setRiotIdBase: async ({
    locals,
    params,
    request,
  }: {
    locals: App.Locals
    params: { id: string }
    request: Request
  }) => {
    if (!locals.user) throw redirect(303, `/auth/login?returnTo=/players/${params.id}`)

    const form = await request.formData()
    const riotIdBase = normalizeRiotBase(form.get('riot_id_base'))
    if (!isValidRiotBase(riotIdBase)) {
      return { success: false, message: 'Enter a valid Riot ID base name (no #tag).' }
    }

    const { data: viewer, error: viewerError } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('auth0_sub', locals.user.sub)
      .maybeSingle()

    if (viewerError || !viewer) throw error(403, 'Profile not found')

    const { data: target, error: targetError } = await supabaseAdmin
      .from('profiles')
      .select('id, auth0_sub')
      .eq('id', params.id)
      .maybeSingle()

    if (targetError || !target) throw error(404, 'Player not found')

    const isSelf = target.auth0_sub && target.auth0_sub === locals.user.sub
    const isAdmin = viewer.role === 'admin'
    if (!isSelf && !isAdmin) throw error(403, 'Not allowed')

    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .ilike('riot_id_base', riotIdBase)
      .neq('id', target.id)
      .maybeSingle()

    if (existing?.id) {
      return { success: false, message: 'That Riot ID is already claimed by another account.' }
    }

    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ riot_id_base: riotIdBase })
      .eq('id', target.id)

    if (updateError) return { success: false, message: updateError.message }

    // Keep the canonical primary account name in step with the legacy column.
    try {
      await syncPrimaryRiotName(target.id, riotIdBase)
    } catch (err) {
      console.warn('Failed to sync primary Riot account name after riot_id_base save:', err)
    }

    // Seed the chosen display name unless the player set one of their own.
    await supabaseAdmin
      .from('profiles')
      .update({ display_name: riotIdBase })
      .eq('id', target.id)
      .eq('display_name_is_custom', false)

    try {
      await claimRelinkAfterProfileUpdate(target.id)
    } catch (err) {
      console.warn('claimRelinkAfterProfileUpdate failed after riot_id_base save:', err)
    }

    try {
      await rematchPlayerMatchMapStatsForBase(target.id, riotIdBase)
    } catch (err) {
      console.warn('Failed to rematch match map stats after riot_id_base save:', err)
    }

    throw redirect(303, `/players/${target.id}`)
  },
  setStatsPlayerName: async ({
    locals,
    params,
    request,
  }: {
    locals: App.Locals
    params: { id: string }
    request: Request
  }) => {
    if (!locals.user) throw redirect(303, `/auth/login?returnTo=/players/${params.id}`)

    const form = await request.formData()
    const statsPlayerName = normalizeRiotBase(form.get('stats_player_name'))
    if (!isValidRiotBase(statsPlayerName)) {
      return { success: false, message: 'Enter a valid stats player name (no #tag).' }
    }

    const { data: viewer, error: viewerError } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('auth0_sub', locals.user.sub)
      .maybeSingle()

    if (viewerError || !viewer) throw error(403, 'Profile not found')

    const { data: target, error: targetError } = await supabaseAdmin
      .from('profiles')
      .select('id, auth0_sub')
      .eq('id', params.id)
      .maybeSingle()

    if (targetError || !target) throw error(404, 'Player not found')

    const isSelf = target.auth0_sub && target.auth0_sub === locals.user.sub
    const isAdmin = viewer.role === 'admin'
    if (!isSelf && !isAdmin) throw error(403, 'Not allowed')

    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .ilike('stats_player_name', statsPlayerName)
      .neq('id', target.id)
      .maybeSingle()

    if (existing?.id) {
      return {
        success: false,
        message: 'That stats player name is already claimed by another account.',
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ stats_player_name: statsPlayerName })
      .eq('id', target.id)

    if (updateError) return { success: false, message: updateError.message }

    try {
      await claimRelinkAfterProfileUpdate(target.id)
    } catch (err) {
      console.warn('claimRelinkAfterProfileUpdate failed after stats_player_name save:', err)
    }

    try {
      await rematchPlayerMatchMapStatsForBase(target.id, statsPlayerName)
    } catch (err) {
      console.warn('Failed to rematch match map stats after stats_player_name save:', err)
    }

    throw redirect(303, `/players/${target.id}`)
  },

  /**
   * Set the chosen display name. Flipping `display_name_is_custom` stops the
   * signup / Riot-ID flows from ever overwriting it again.
   */
  setDisplayName: async ({
    locals,
    params,
    request,
  }: {
    locals: App.Locals
    params: { id: string }
    request: Request
  }) => {
    if (!locals.user) throw redirect(303, `/auth/login?returnTo=/players/${params.id}`)

    const form = await request.formData()
    const displayName = String(form.get('display_name') ?? '')
      .trim()
      .slice(0, 40)
    if (displayName.length < 2) {
      return { success: false, message: 'Enter a display name of at least 2 characters.' }
    }

    const { data: viewer } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('auth0_sub', locals.user.sub)
      .maybeSingle()
    if (!viewer) throw error(403, 'Profile not found')

    const { data: target } = await supabaseAdmin
      .from('profiles')
      .select('id, auth0_sub')
      .eq('id', params.id)
      .maybeSingle()
    if (!target) throw error(404, 'Player not found')

    const isSelf = target.auth0_sub && target.auth0_sub === locals.user.sub
    if (!isSelf && viewer.role !== 'admin') throw error(403, 'Not allowed')

    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ display_name: displayName, display_name_is_custom: true })
      .eq('id', target.id)

    if (updateError) return { success: false, message: updateError.message }

    throw redirect(303, `/players/${target.id}`)
  },
}
