import { error, redirect } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { fetchAllRowsResult } from '$lib/server/supabase/fetch-all'
import { claimRelinkAfterProfileUpdate } from '$lib/server/players/claim-relink'
import { normalizeRiotBase, isValidRiotBase } from '$lib/server/riot-id'
import { toBatchLabel } from '$lib/server/stats/batch-label'
import { average, sum } from '$lib/server/math'
import {
  extractNumericLabel,
  isLatestLabel,
  normalizeRivalsGroupStatBatchFromDb,
  runRivalsBatchQuery,
  type NormalizedRivalsGroupStatBatch,
  type StatImportBatchRow,
} from '$lib/server/stats/rivals-batch'
import { isWeekBatch } from '$lib/stats/sections'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import {
  parseFullSeasonBatchId,
  resolveSeasonStatBatchIds,
  toFullSeasonBatchId,
} from '$lib/server/stats/season-batches'
import { aggregateFullSeasonRows } from '$lib/server/stats/aggregate-full-season'
import { groupBatchesByEvent } from '$lib/server/stats/batch-events'
import { getValorantMapLookup, mapThumbFor } from '$lib/server/valorant/maps'
import { rematchPlayerMatchMapStatsForBase } from '$lib/server/imports/matching'
import { rankValue } from '$lib/ranks/ranks'
import { loadCommentThread } from '$lib/server/comments'
import { getViewerProfileId } from '$lib/server/auth/viewer'
import {
  loadRosterTimeline,
  loadSubOverridesForMatches,
  matchRosterTime,
  resolveIsSub,
  type RosterTimeline,
} from '$lib/server/matches/subs'
import {
  claimRiotName,
  listProfileRiotAccounts,
  riotNameOwnedByOther,
  setStatsNameAlias,
  statsNameAlias,
} from '$lib/server/players/riot-accounts'
import { loadPlayerDirectory, riotNamesByProfile } from '$lib/server/players/directory'
import {
  loadReassignmentsForMatches,
  loadReassignmentsToProfile,
  reassignedProfileFor,
  type MatchStatReassignment,
} from '$lib/server/matches/reassignments'

import { type TeamRel, loadTeamHistory } from '$lib/server/players/team-history'
import {
  type StatRow,
  type NormalizedStatRow,
  type MatchRel,
  type ParticipatedRow,
  type MatchHistoryEntry,
  type PerMapStatRow,
  aggregateStats,
  buildBreakdowns,
} from '$lib/server/players/profile-stats'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function kindOrder(kind: unknown): number {
  return kind === 'aggregate' ? 0 : 1
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
    .select('id, auth0_sub, role, display_name, email, created_at, discord_username')
    .eq('id', profileId)
    .maybeSingle()

  if (profileError) {
    const msg = String((profileError as { message?: string }).message ?? '')
    throw error(500, msg || 'Failed to load player')
  }

  if (!profileRel) throw error(404, 'Player not found')

  // The player's Riot identity: primary account, every name they are known by
  // (for matching stat rows that predate their claim), and any stats alias.
  const [directory, riotNames, statsAlias] = await Promise.all([
    loadPlayerDirectory([profileId]),
    riotNamesByProfile([profileId]),
    statsNameAlias(profileId),
  ])
  const directoryEntry = directory.get(profileId) ?? null
  const knownNames = [profileRel.display_name, ...(riotNames.get(profileId) ?? [])]

  // Viewer permissions for inline Riot ID setup.
  let canEditRiotIdBase = false
  if (locals.user) {
    if (profileRel.auth0_sub && profileRel.auth0_sub === locals.user.sub) {
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
    { data: latestSignup },
    { data: statsRows },
    { data: allSeasonsRaw },
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
    // The Discord handle the player typed most recently, whatever the
    // signup's status; the profile's copies cover players with no signup.
    supabaseAdmin
      .from('player_signups')
      .select('discord_handle, updated_at')
      .eq('profile_id', profileId)
      .not('discord_handle', 'is', null)
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
    // For mapping an aggregate batch back to its season, so the Map/Agent
    // breakdowns can scope to that season's matches.
    // Newest first, which is also the order the batch picker lists events in.
    supabaseAdmin
      .from('seasons')
      .select('id, code, name, kind, metadata, starts_on, created_at')
      .order('starts_on', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
  ])

  type SeasonMetaRow = {
    id: string
    code?: string | null
    name?: string | null
    kind?: string | null
    metadata?: { stat_batches?: unknown } | null
  }
  const allSeasons = (allSeasonsRaw ?? []) as SeasonMetaRow[]

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
      knownNames.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)
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
    ? await runRivalsBatchQuery<Array<StatImportBatchRow & { season_id?: string | null }>>(
        (select) =>
          supabaseAdmin
            .from('stat_import_batches')
            .select(`${select}, season_id`)
            .in('id', batchIds)
            .order('created_at', { ascending: false })
            .returns<Array<StatImportBatchRow & { season_id?: string | null }>>()
      )
    : { data: [] }

  // Raw batch rows keyed by id, for the metadata/season lookup that scopes the
  // match-based Map/Agent tables below.
  type RawBatchRow = {
    id: string
    season_id?: string | null
    metadata?: { source_match_ids?: unknown } | null
  }
  const rawBatchById = new Map<string, RawBatchRow>()
  for (const b of (batches ?? []) as RawBatchRow[]) rawBatchById.set(b.id, b)

  // Week batches are not shown on the site, so their rows are dropped too.
  const batchById = new Map<string, NormalizedRivalsGroupStatBatch>()
  const weekBatchIds = new Set<string>()
  for (const b of batches ?? []) {
    const normalized = normalizeRivalsGroupStatBatchFromDb(b as StatImportBatchRow, {
      displayNameFallback: 'source_filename',
    })
    if (isWeekBatch(normalized)) weekBatchIds.add(b.id)
    else batchById.set(b.id, normalized)
  }

  const visibleStatRows = ((statsRows ?? []) as StatRow[]).filter(
    (r) => !weekBatchIds.has(r.import_batch_id)
  )

  // One "Full Season" line per season the player has phase rows in, summed the
  // same way the stats API sums its `season:<code>` batches so the two pages
  // agree. Nothing is stored under these ids.
  const fullSeasonStats: NormalizedStatRow[] = []
  for (const season of allSeasons) {
    if (!season.code) continue
    const sourceIds = new Set(resolveSeasonStatBatchIds(season))
    const rows = visibleStatRows.filter((r) => sourceIds.has(r.import_batch_id))
    if (rows.length === 0) continue
    const id = toFullSeasonBatchId(season.code)
    // Every row is this player's, so the sum is a single line.
    const [row] = aggregateFullSeasonRows(rows, id)
    if (!row) continue
    fullSeasonStats.push({
      ...row,
      batch: {
        id,
        display_name: `${season.name ?? 'Season'} (Full)`,
        source_filename: null,
        import_kind: 'aggregate',
        week_label: null,
        section: 'full',
        created_at: null,
        sort_order: null,
      },
    })
  }

  const sortedBatches = Array.from(batchById.values())
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
      id: b.id,
      display_name: toBatchLabel(b),
      section: b.section ?? null,
      import_kind: b.import_kind ?? null,
      week_label: b.week_label ?? null,
    }))
  // Same event-then-phase picker as the stats page.
  const { batches: pickerBatches, events: batchEvents } = groupBatchesByEvent(
    [
      ...fullSeasonStats.map((r) => ({
        id: r.batch.id,
        display_name: r.batch.display_name,
        section: 'full',
        import_kind: 'aggregate',
        week_label: null,
      })),
      ...sortedBatches,
    ],
    allSeasons,
    (batches ?? []) as RawBatchRow[]
  )

  const normalizedStats: NormalizedStatRow[] = [
    ...fullSeasonStats,
    ...visibleStatRows.map((r) => ({
      ...r,
      batch: batchById.get(r.import_batch_id) ?? {
        id: r.import_batch_id,
        display_name: r.import_batch_id,
      },
    })),
  ]

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
      // Full Season lines stay opt-in; the default is still an imported batch.
      (r) => r.batch?.import_kind === 'aggregate' && r.batch?.section !== 'full'
    )

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

    selected = aggregates[0] ?? normalizedStats[0] ?? null
  }

  const matchMapStatsSelect = `
      id,
      match_id,
      profile_id,
      player_name,
      puuid,
      team_id,
      metadata,
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
        season_id,
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
      knownNames
        .flatMap((name) => {
          const raw = String(name ?? '').trim()
          const base = normalizeNameBase(raw)
          return raw && base ? [raw, base, `${base}#%`] : []
        })
        .filter(Boolean)
    )
  )

  const perMapSelect =
    'id, match_id, team_id, puuid, player_name, agents, acs, kills, deaths, assists, kd, adr, kast_pct, hs_pct, rounds, fk, fd, plants, defuses, match_maps(map_name, is_voided, team_a_rounds, team_b_rounds, matches(team_a_id, team_b_id, season_id))'

  const [
    { data: accoladeAssignments },
    { data: claimedParticipation },
    { data: unmatchedParticipation },
    { data: perMapClaimedStats },
    { data: perMapUnmatchedStats },
    reassignedToProfile,
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
    // Every map, not a capped page: these feed career per-map averages.
    fetchAllRowsResult(() =>
      supabaseAdmin
        .from('player_match_map_stats')
        .select(perMapSelect)
        .eq('profile_id', profileId)
        .order('id')
    ),
    importNameFilters.length > 0
      ? fetchAllRowsResult(() =>
          supabaseAdmin
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
            .order('id')
        )
      : Promise.resolve({ data: [] }),
    loadReassignmentsToProfile(profileId).catch(() => [] as MatchStatReassignment[]),
  ])

  // Admin stat reassignments (an alt account's match moved onto a player) are
  // the authority on who owns those rows. Fetch the moved matches' rows
  // directly so the match shows in this history even if a later write left the
  // rows on another owner, and drop rows that were moved off this profile (a
  // name match would otherwise pull them back in).
  const reassignedMatchIds = Array.from(new Set(reassignedToProfile.map((r) => r.match_id)))
  const seenMatchIds = [
    ...reassignedMatchIds,
    ...[
      ...(claimedParticipation ?? []),
      ...(unmatchedParticipation ?? []),
      ...(perMapClaimedStats ?? []),
      ...(perMapUnmatchedStats ?? []),
    ].map((row) => String((row as { match_id?: string | null }).match_id ?? '')),
  ]
  const [
    { data: reassignedParticipationAll },
    { data: reassignedPerMapAll },
    reassignmentsByMatch,
  ] = await Promise.all([
    reassignedMatchIds.length > 0
      ? supabaseAdmin
          .from('player_match_map_stats')
          .select(matchMapStatsSelect)
          .in('match_id', reassignedMatchIds)
      : Promise.resolve({ data: [] }),
    reassignedMatchIds.length > 0
      ? supabaseAdmin
          .from('player_match_map_stats')
          .select(perMapSelect)
          .in('match_id', reassignedMatchIds)
      : Promise.resolve({ data: [] }),
    loadReassignmentsForMatches(seenMatchIds).catch(
      () => new Map<string, MatchStatReassignment[]>()
    ),
  ])
  const reassignedOwner = (row: {
    match_id?: string | null
    puuid?: string | null
    player_name?: string | null
    metadata?: Record<string, unknown> | null
  }) => reassignedProfileFor(reassignmentsByMatch.get(String(row.match_id ?? '')), row)
  const ownsRow = (row: Parameters<typeof reassignedOwner>[0]) => {
    const owner = reassignedOwner(row)
    return owner === undefined || owner === profileId
  }
  const movedHere = (row: Parameters<typeof reassignedOwner>[0]) =>
    reassignedOwner(row) === profileId

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
    ...((reassignedParticipationAll ?? []) as ParticipatedRow[]).filter(movedHere),
  ]) {
    const id = String(row.id ?? '')
    if (!id || seenParticipationIds.has(id) || !ownsRow(row)) continue
    seenParticipationIds.add(id)

    const matchRel = Array.isArray(row.matches) ? row.matches[0] : row.matches
    if (!matchRel?.id) continue
    const current = groupedParticipation.get(matchRel.id) ?? []
    current.push(row)
    groupedParticipation.set(matchRel.id, current)
  }

  // Sub detection for the history rows: a team's roster is judged in its own
  // season and as of the match day, so a player who moved teams mid-event stays
  // a starter in the old team's earlier matches. Overrides are fetched once for
  // all matches.
  const seasonToTeams = new Map<string, Set<string>>()
  const historyMatchIds: string[] = []
  for (const rows of groupedParticipation.values()) {
    const r = rows[0]
    const matchRel = Array.isArray(r.matches) ? r.matches[0] : r.matches
    if (matchRel?.id) historyMatchIds.push(matchRel.id)
    const seasonKey = matchRel?.season_id ?? ''
    const teamId = r.team_id ?? null
    if (!teamId) continue
    const set = seasonToTeams.get(seasonKey) ?? new Set<string>()
    set.add(teamId)
    seasonToTeams.set(seasonKey, set)
  }

  const seasonKeys = Array.from(seasonToTeams.keys())
  const [subOverridesByMatch, ...timelines] = await Promise.all([
    loadSubOverridesForMatches(historyMatchIds),
    ...seasonKeys.map((seasonKey) =>
      loadRosterTimeline(seasonKey || null, Array.from(seasonToTeams.get(seasonKey) ?? []))
    ),
  ])
  const timelineBySeason = new Map<string, RosterTimeline>(
    seasonKeys.map((seasonKey, index) => [seasonKey, timelines[index] as RosterTimeline])
  )

  // One sub/starter verdict per match, decided once and reused for the match
  // history rows and the Map/Agent breakdown split below. A player takes one
  // team per match, so keying by match id is unambiguous.
  const subByMatchId = new Map<string, boolean>()
  for (const rows of groupedParticipation.values()) {
    const r = rows[0]
    const matchRel = Array.isArray(r.matches) ? r.matches[0] : r.matches
    if (!matchRel?.id) continue
    const puuid = (r.metadata as Record<string, unknown> | null)?.puuid as string | null
    const isSub = r.team_id
      ? resolveIsSub({
          overrides: subOverridesByMatch.get(matchRel.id) ?? [],
          roster: timelineBySeason
            .get(matchRel.season_id ?? '')
            ?.at(matchRosterTime(matchRel))
            .get(r.team_id),
          profileId,
          playerName: r.player_name,
          puuid,
        })
      : false
    subByMatchId.set(matchRel.id, isSub)
  }

  // The Map/Agent breakdowns and match history come from match imports, not
  // leaderboard batches, so the batch selector can only scope them indirectly. A batch generated from
  // matches carries the exact `source_match_ids` behind it — the precise scope.
  // Older season aggregates have no such list, so they fall back to their season
  // (curated mapping first, then the batch's own season_id column). Weekly CSV
  // batches and "All Time" aggregates resolve to neither and leave the tables
  // showing every recorded map.
  let mapStatsScope: string | null = null
  let scopedMatchIds: Set<string> | null = null
  let scopedSeasonId: string | null = null

  const fullSeasonCode = parseFullSeasonBatchId(selected?.import_batch_id)
  if (fullSeasonCode) {
    const season = allSeasons.find((s) => s.code === fullSeasonCode)
    if (season) {
      scopedSeasonId = season.id
      mapStatsScope = season.name ?? season.code ?? null
    }
  } else if (selected?.batch?.import_kind === 'aggregate' && selected.import_batch_id) {
    const rawBatch = rawBatchById.get(selected.import_batch_id)
    const sourceMatchIds = rawBatch?.metadata?.source_match_ids
    if (Array.isArray(sourceMatchIds) && sourceMatchIds.length > 0) {
      scopedMatchIds = new Set(sourceMatchIds.filter((id): id is string => typeof id === 'string'))
      mapStatsScope = selected.batch.display_name ?? null
    } else {
      for (const s of allSeasons) {
        if (resolveSeasonStatBatchIds(s).includes(selected.import_batch_id)) {
          scopedSeasonId = s.id
          mapStatsScope = s.name ?? s.code ?? null
          break
        }
      }
      if (!scopedSeasonId && rawBatch?.season_id) {
        scopedSeasonId = rawBatch.season_id
        const s = allSeasons.find((x) => x.id === scopedSeasonId)
        mapStatsScope = s?.name ?? s?.code ?? selected.batch.display_name ?? null
      }
    }
  }

  const matchIdScope = scopedMatchIds
  const seasonScope = scopedSeasonId
  const isMatchInScope = (
    matchId: string | null | undefined,
    seasonId: string | null | undefined
  ) =>
    matchIdScope
      ? matchId != null && matchIdScope.has(matchId)
      : seasonScope
        ? seasonId === seasonScope
        : true

  const matchHistory = Array.from(groupedParticipation.values())
    .map((rows): MatchHistoryEntry => {
      const r = rows[0]
      const matchRel = Array.isArray(r.matches) ? r.matches[0] : r.matches
      const isSub = matchRel?.id ? (subByMatchId.get(matchRel.id) ?? false) : false
      // The side the player actually played on comes from the stat rows. The
      // current team is only a fallback: after a move between two teams that met,
      // it would frame the old matches from the opponent's side.
      const isSide = (id: string | null | undefined) =>
        Boolean(id) && (id === matchRel?.team_a_id || id === matchRel?.team_b_id)
      const playedTeamId = rows.map((entry) => entry.team_id).find(isSide) ?? null
      const perspectiveTeamId =
        playedTeamId ?? (activeTeam && isSide(activeTeam.id) ? activeTeam.id : null)
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
        is_sub: isSub,
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
        Boolean(x.match) &&
        x.match?.approval_status === 'approved' &&
        isMatchInScope(x.match.id, x.match.season_id)
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
    ...((reassignedPerMapAll ?? []) as unknown as (PerMapStatRow & { id: string })[]).filter(
      movedHere
    ),
  ]) {
    if (seenPerMapIds.has(r.id) || !ownsRow(r)) continue
    seenPerMapIds.add(r.id)
    perMapRawStats.push(r)
  }

  const validMapStats = (perMapRawStats as PerMapStatRow[]).filter((r) => {
    const mm = Array.isArray(r.match_maps) ? r.match_maps[0] : r.match_maps
    return mm && !mm.is_voided && mm.map_name
  })

  const scopedMapStats = validMapStats.filter((r) => {
    const mm = Array.isArray(r.match_maps) ? r.match_maps[0] : r.match_maps
    const match = mm && (Array.isArray(mm.matches) ? mm.matches[0] : mm.matches)
    return isMatchInScope(r.match_id, match?.season_id)
  })

  // Split the scoped maps into starter and sub buckets by their match verdict.
  // An unknown match id (no participation row on record) counts as a starter,
  // matching the conservative default in autoIsSub.
  const isSubMapRow = (r: PerMapStatRow) =>
    Boolean(r.match_id && subByMatchId.get(r.match_id) === true)
  const { mapStats, agentStats } = buildBreakdowns(scopedMapStats)
  // List-view thumbnails for the Breakdown's map rows, keyed by lowercased map
  // name. The lookup is cached server-wide, so only the first page pays for it.
  const mapArt: Record<string, string> = {}
  if (mapStats.length > 0) {
    const mapLookup = await getValorantMapLookup()
    for (const m of mapStats) {
      const url = mapThumbFor(mapLookup, m.key)
      if (url) mapArt[m.key.toLowerCase()] = url
    }
  }
  const subMapRows = scopedMapStats.filter(isSubMapRow)
  const mainMapRows = scopedMapStats.filter((r) => !isSubMapRow(r))
  const subBreakdowns = buildBreakdowns(subMapRows)
  const mainBreakdowns = buildBreakdowns(mainMapRows)
  // Overall per-role totals for the KPI tiles. Leaderboard batches carry no
  // starter/sub split, so the Main / Sub views are rebuilt from per-map rows.
  const rosterTotals = {
    main: aggregateStats(mainMapRows),
    sub: aggregateStats(subMapRows),
  }

  // How many matches fall in each bucket, so the client only offers the filter
  // when the player has actually played both roles in the selected scope.
  let subGames = 0
  let mainGames = 0
  for (const rows of groupedParticipation.values()) {
    const r = rows[0]
    const matchRel = Array.isArray(r.matches) ? r.matches[0] : r.matches
    if (!matchRel?.id || !isMatchInScope(matchRel.id, matchRel.season_id)) continue
    if (subByMatchId.get(matchRel.id)) subGames += 1
    else mainGames += 1
  }

  // Sequential rather than parallel: the thread needs the viewer's profile id
  // to mark which comments they have already voted on.
  const viewerProfileId = await getViewerProfileId(locals.user)
  const playerComments = await loadCommentThread('player', profileId, {
    includeReportCounts: locals.user?.role === 'admin',
    viewerProfileId,
  })

  const riotAccounts = await listProfileRiotAccounts(profileId)

  // All-time peak: the highest rank on any of the player's stat rows (ranks
  // assigned in stat imports) or any tournament rank recorded for one of their
  // Riot accounts (the peak they held during each tournament's dates).
  const accountPuuids = riotAccounts
    .filter((a) => a.status !== 'rejected' && a.riot_puuid)
    .map((a) => a.riot_puuid as string)
  const { data: seasonRanks } = accountPuuids.length
    ? await supabaseAdmin.from('riot_season_ranks').select('rank').in('puuid', accountPuuids)
    : { data: [] }
  let bestRank: string | null = null
  let bestRankValue = 0
  for (const raw of [
    ...normalizedStats.map((r) => r.league_rank as string | null),
    ...(seasonRanks ?? []).map((r) => r.rank as string),
  ]) {
    if (!raw) continue
    const v = rankValue(raw)
    if (v > bestRankValue) {
      bestRankValue = v
      bestRank = raw
    }
  }

  return {
    player: {
      profile_id: profileId,
      // The chosen display name is authoritative; Riot name and email are only
      // fallbacks for profiles that never set one.
      riot_id: profileRel.display_name ?? directoryEntry?.riot_name ?? profileRel.email ?? 'Player',
      riot_id_base: directoryEntry?.riot_name ?? null,
      stats_player_name: statsAlias,
      has_unmatched_stats_candidate: hasUnmatchedStatsCandidate,
      rank_label: null,
      rank_value: null,
      pronouns: null,
      // The signup's handle, else the name from their Discord login.
      discord_handle:
        (latestSignup as { discord_handle?: string | null } | null)?.discord_handle ||
        profileRel.discord_username ||
        null,
      display_name: profileRel?.display_name ?? null,
      email: profileRel?.email ?? null,
      created_at: profileRel?.created_at ?? null,
    },
    bestRank,
    activeTeam,
    teamHistory,
    activeSeasonId: currentSeasonId,
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
      batches: pickerBatches,
      batchEvents,
    },
    matchHistory,
    mapStats,
    mapArt,
    agentStats,
    // Same Map/Agent breakdowns split by the player's role in each match, so the
    // profile can offer an All / Main / Sub filter. Match history rows carry
    // their own `is_sub`, so the client filters those directly.
    mapStatsMain: mainBreakdowns.mapStats,
    agentStatsMain: mainBreakdowns.agentStats,
    mapStatsSub: subBreakdowns.mapStats,
    agentStatsSub: subBreakdowns.agentStats,
    rosterSplit: { subGames, mainGames },
    // Main vs Sub compares one season's (or one generated batch's) matches. A
    // batch that resolves to neither would compare every match on record under
    // a header naming one event, so the comparison is offered only when scoped.
    rosterCompareScoped: matchIdScope !== null || seasonScope !== null,
    rosterTotals,
    // Non-null when the Map/Agent tables are scoped by the selected aggregate
    // batch (to its source matches or season); null when they show every
    // recorded map.
    mapStatsScope,
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

    if (await riotNameOwnedByOther(riotIdBase, target.id)) {
      return { success: false, message: 'That Riot ID is already claimed by another account.' }
    }

    // Becomes the primary Riot account when the player has none yet.
    try {
      await claimRiotName(target.id, riotIdBase)
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Failed to save.' }
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
      console.warn('claimRelinkAfterProfileUpdate failed after Riot name save:', err)
    }

    try {
      await rematchPlayerMatchMapStatsForBase(target.id, riotIdBase)
    } catch (err) {
      console.warn('Failed to rematch match map stats after Riot name save:', err)
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

    if (await riotNameOwnedByOther(statsPlayerName, target.id)) {
      return {
        success: false,
        message: 'That stats player name is already claimed by another account.',
      }
    }

    // Stored as a tagless Riot account, so every name matcher sees it.
    try {
      await setStatsNameAlias(target.id, statsPlayerName)
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Failed to save.' }
    }

    try {
      await claimRelinkAfterProfileUpdate(target.id)
    } catch (err) {
      console.warn('claimRelinkAfterProfileUpdate failed after stats alias save:', err)
    }

    try {
      await rematchPlayerMatchMapStatsForBase(target.id, statsPlayerName)
    } catch (err) {
      console.warn('Failed to rematch match map stats after stats alias save:', err)
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
