import { error, redirect } from '@sveltejs/kit'
import { cardVersion, joinDescription, statText, type PageMeta } from '$lib/meta'
import { supabaseAdmin } from '$lib/supabase/admin'
import { fetchAllRowsResult } from '$lib/server/supabase/fetch-all'
import { claimRelinkAfterProfileUpdate } from '$lib/server/players/claim-relink'
import { normalizeRiotBase, isValidRiotBase } from '$lib/server/riot-id'
import { average, sum } from '$lib/server/math'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { parseFullSeasonBatchId, resolveSeasonStatBatchIds } from '$lib/server/stats/season-batches'
import { getValorantMapLookup, mapThumbFor } from '$lib/server/valorant/maps'
import { rematchPlayerMatchMapStatsForBase } from '$lib/server/imports/matching'
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

import {
  loadPeakRank,
  PROFILE_SEASON_COLUMNS,
  PROFILE_STAT_COLUMNS,
  selectProfileStats,
  type ProfileSeasonRow,
} from '$lib/server/players/profile-stat-selection'
import { type TeamRel, loadTeamHistory } from '$lib/server/players/team-history'
import {
  type StatRow,
  type MatchRel,
  type ParticipatedRow,
  type MatchHistoryEntry,
  type PerMapStatRow,
  aggregateStats,
  buildBreakdowns,
} from '$lib/server/players/profile-stats'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
    .select(
      'id, auth0_sub, role, display_name, email, created_at, discord_username, discord_id, avatar_url'
    )
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
      .select(PROFILE_STAT_COLUMNS)
      .eq('profile_id', profileId)
      .order('imported_at', { ascending: false })
      .limit(200),
    // For mapping an aggregate batch back to its season, so the Map/Agent
    // breakdowns can scope to that season's matches.
    // Newest first, which is also the order the batch picker lists events in.
    supabaseAdmin
      .from('seasons')
      .select(PROFILE_SEASON_COLUMNS)
      .order('starts_on', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
  ])

  const allSeasons = (allSeasonsRaw ?? []) as ProfileSeasonRow[]

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

  const { normalizedStats, selected, pickerBatches, batchEvents, rawBatchById } =
    await selectProfileStats((statsRows ?? []) as StatRow[], allSeasons, selectedBatchId)

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

  // External events (Shitter League) are hidden on the client unless shown, so
  // every match-derived stat is built twice: with them and without. Otherwise a
  // sub appearance in an external event would surface a Main / Sub split under a
  // Rivals scope whose match history no longer lists that match.
  const externalSeasonIds = new Set(
    allSeasons.filter((s) => s.kind === 'external').map((s) => s.id)
  )
  const isExternalMapRow = (r: PerMapStatRow) => {
    const mm = Array.isArray(r.match_maps) ? r.match_maps[0] : r.match_maps
    const match = mm && (Array.isArray(mm.matches) ? mm.matches[0] : mm.matches)
    return Boolean(match?.season_id && externalSeasonIds.has(match.season_id))
  }
  const buildRoleStats = (rows: PerMapStatRow[], includeExternal: boolean) => {
    const mapRows = includeExternal ? rows : rows.filter((r) => !isExternalMapRow(r))
    const subMapRows = mapRows.filter(isSubMapRow)
    const mainMapRows = mapRows.filter((r) => !isSubMapRow(r))
    const all = buildBreakdowns(mapRows)
    const sub = buildBreakdowns(subMapRows)
    const main = buildBreakdowns(mainMapRows)
    // How many matches fall in each bucket, so the client only offers the
    // filter when the player has actually played both roles in the scope.
    let subGames = 0
    let mainGames = 0
    for (const group of groupedParticipation.values()) {
      const r = group[0]
      const matchRel = Array.isArray(r.matches) ? r.matches[0] : r.matches
      if (!matchRel?.id || !isMatchInScope(matchRel.id, matchRel.season_id)) continue
      if (!includeExternal && matchRel.season_id && externalSeasonIds.has(matchRel.season_id))
        continue
      if (subByMatchId.get(matchRel.id)) subGames += 1
      else mainGames += 1
    }
    return {
      mapStats: all.mapStats,
      agentStats: all.agentStats,
      // Same Map/Agent breakdowns split by the player's role in each match, so
      // the profile can offer an All / Main / Sub filter. Match history rows
      // carry their own `is_sub`, so the client filters those directly.
      mapStatsMain: main.mapStats,
      agentStatsMain: main.agentStats,
      mapStatsSub: sub.mapStats,
      agentStatsSub: sub.agentStats,
      rosterSplit: { subGames, mainGames },
      // Overall per-role totals for the KPI tiles. Leaderboard batches carry no
      // starter/sub split, so the Main / Sub views are rebuilt from per-map rows.
      rosterTotals: { main: aggregateStats(mainMapRows), sub: aggregateStats(subMapRows) },
    }
  }
  const roleStats = buildRoleStats(scopedMapStats, true)
  const roleStatsNoExternal = buildRoleStats(scopedMapStats, false)
  const { mapStats } = roleStats
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

  // Sequential rather than parallel: the thread needs the viewer's profile id
  // to mark which comments they have already voted on.
  const viewerProfileId = await getViewerProfileId(locals.user)
  const playerComments = await loadCommentThread('player', profileId, {
    includeReportCounts: locals.user?.role === 'admin',
    viewerProfileId,
  })

  const riotAccounts = await listProfileRiotAccounts(profileId)

  // All-time peak: the highest rank on any of the player's stat rows or any
  // tournament rank recorded for one of their Riot accounts.
  const bestRank = await loadPeakRank(normalizedStats, riotAccounts)

  // Link preview: who they play for and their headline numbers.
  const metaName =
    profileRel.display_name ?? directoryEntry?.riot_name ?? profileRel.email ?? 'Player'
  const statBits = selected
    ? [
        statText(selected.acs) && `ACS ${statText(selected.acs)}`,
        statText(selected.kd, 2) && `K/D ${statText(selected.kd, 2)}`,
        statText(selected.kast_pct) && `KAST ${statText(selected.kast_pct)}%`,
        statText(selected.games) && `${statText(selected.games)} maps`,
      ].filter(Boolean)
    : []
  const metaStats = statBits.length
    ? `${selected?.batch?.display_name ? `${selected.batch.display_name}: ` : ''}${statBits.join(', ')}`
    : null
  const meta: PageMeta = {
    title: metaName,
    description: joinDescription([
      activeTeam ? activeTeam.name : null,
      bestRank ? `Peak ${bestRank}` : null,
      metaStats,
    ]),
    // The generated card (/og/player/[id].png) for the same stats table. The
    // `v` changes with what the card shows, so Discord fetches a fresh image.
    image: `/og/player/${profileId}.png?${new URLSearchParams({
      ...(selectedBatchId && selected?.import_batch_id === selectedBatchId
        ? { batchId: selectedBatchId }
        : {}),
      v: cardVersion([
        metaName,
        profileRel.discord_id ? profileRel.avatar_url : null,
        activeTeam?.id ?? teamHistory[0]?.team.id ?? null,
        bestRank,
        selected?.import_batch_id ?? null,
        ...['acs', 'kd', 'kast_pct', 'games'].map((key) => selected?.[key] ?? null),
      ]),
    })}`,
    largeImage: true,
    type: 'profile',
  }

  return {
    meta,
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
      // Picture from their Discord login, refreshed every sign-in. Only for
      // Discord-linked profiles: other Auth0 logins get a generated placeholder.
      avatar_url: profileRel.discord_id ? (profileRel.avatar_url ?? null) : null,
      display_name: profileRel?.display_name ?? null,
      email: profileRel?.email ?? null,
      created_at: profileRel?.created_at ?? null,
    },
    bestRank,
    activeTeam,
    teamHistory,
    activeSeasonId: currentSeasonId,
    // External events (Shitter League) are hidden on the client unless shown.
    externalSeasonIds: allSeasons.filter((s) => s.kind === 'external').map((s) => s.id),
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
    mapArt,
    // Match-derived stats with external events included, and without them for
    // when the client hides those events.
    roleStats,
    roleStatsNoExternal,
    // Main vs Sub compares one season's (or one generated batch's) matches. A
    // batch that resolves to neither would compare every match on record under
    // a header naming one event, so the comparison is offered only when scoped.
    rosterCompareScoped: matchIdScope !== null || seasonScope !== null,
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
