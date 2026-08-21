import { redirect } from '@sveltejs/kit'

import { supabaseAdmin } from '$lib/supabase/admin'
import { requireAdmin } from '$lib/server/auth/profile'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { getSeasonLogoUrl } from '$lib/server/seasons/logo'
import { getValorantMapList } from '$lib/server/valorant/maps'
import type { MatchStreamRow } from '$lib/server/db-rows'

type RosterProfileRow = {
  id: string
  display_name: string | null
  email: string | null
  riot_id_base: string | null
}

export const load = async ({ locals }: { locals: App.Locals }) => {
  if (!locals.user) {
    throw redirect(303, '/auth/login?returnTo=/admin')
  }

  await requireAdmin(locals.user)

  // Fetch all users
  const { data: users, error: usersError } = await supabaseAdmin
    .from('profiles')
    .select('id, email, display_name, role, riot_id_base, created_at')
    .order('created_at', { ascending: false })

  if (usersError) {
    console.error('Error fetching users:', usersError)
  }

  const { data: seasons, error: seasonsError } = await supabaseAdmin
    .from('seasons')
    // Results columns must be here too: the seasons tab seeds its edit form
    // from this payload, and a missing field would be saved back as null.
    .select(
      `id, code, name, kind, starts_on, ends_on, is_active, metadata, created_at, logo_path,
       summary, winner_team_id, runner_up_team_id, mvp_profile_id, final_leaderboard_batch_id`
    )
    .order('is_active', { ascending: false })
    .order('starts_on', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (seasonsError) {
    console.error('Error fetching seasons:', seasonsError)
  }

  const activeSeason = (seasons ?? []).find((s: any) => s.is_active) ?? null

  // Teams are admin-managed; load approved teams.
  let approvedTeamsQuery = supabaseAdmin
    .from('teams')
    .select(
      `
      id,
      name,
      tag,
      logo_path,
      metadata,
      status,
      season_id,
      approval_status,
      created_at
    `
    )
    .eq('approval_status', 'approved')

  if (activeSeason) {
    approvedTeamsQuery = approvedTeamsQuery.eq('season_id', activeSeason.id)
  }

  const { data: approvedTeams, error: approvedTeamsError } = await approvedTeamsQuery.order(
    'created_at',
    { ascending: false }
  )

  if (approvedTeamsError) {
    console.error('Error fetching approved teams:', approvedTeamsError)
  }

  /**
   * Every approved team, whatever season it belongs to. The list above is
   * narrowed by the season picker, which is right for the Teams and Matches
   * tabs but not for the Seasons tab: its per-season pickers each need the
   * teams of the season on that row, not the one selected globally.
   */
  const { data: seasonTeams, error: seasonTeamsError } = await supabaseAdmin
    .from('teams')
    .select('id, name, tag, season_id')
    .eq('approval_status', 'approved')
    .order('name', { ascending: true })

  if (seasonTeamsError) {
    console.error('Error fetching teams for season pickers:', seasonTeamsError)
  }

  /** Same reasoning as `seasonTeams`, for the playoff pick'em match links. */
  const { data: seasonMatches, error: seasonMatchesError } = await supabaseAdmin
    .from('matches')
    .select(
      `
      id,
      season_id,
      scheduled_at,
      team_a_id,
      team_b_id,
      team_a:teams!matches_team_a_id_fkey (id, name, tag),
      team_b:teams!matches_team_b_id_fkey (id, name, tag)
    `
    )
    .order('scheduled_at', { ascending: true, nullsFirst: false })

  if (seasonMatchesError) {
    console.error('Error fetching matches for season pickers:', seasonMatchesError)
  }

  // Each season's pick'em event + its match rows, for the Pick'em tab editor.
  const { data: pickemEventRows, error: pickemEventsError } = await supabaseAdmin
    .from('pickem_events')
    .select(
      `id, season_id, format, title, status, lock_at, config,
       pickem_matches (slot_key, group_key, sort_order, label, points, team_a_id, team_b_id, feed_a, feed_b, linked_match_id, actual_winner_id)`
    )

  if (pickemEventsError) {
    console.error('Error fetching pick’em events:', pickemEventsError)
  }

  const pickems = (pickemEventRows ?? []).map((row) => {
    const config =
      row.config && typeof row.config === 'object' ? (row.config as Record<string, unknown>) : {}
    const matches = ((row.pickem_matches ?? []) as Array<Record<string, unknown>>)
      .map((m) => ({
        slotKey: m.slot_key as string,
        groupKey: (m.group_key as string) ?? '',
        sortOrder: (m.sort_order as number) ?? 0,
        label: (m.label as string) ?? '',
        points: (m.points as number) ?? 1,
        teamAId: (m.team_a_id as string | null) ?? null,
        teamBId: (m.team_b_id as string | null) ?? null,
        feedA: (m.feed_a as unknown) ?? null,
        feedB: (m.feed_b as unknown) ?? null,
        linkedMatchId: (m.linked_match_id as string | null) ?? null,
        actualWinnerId: (m.actual_winner_id as string | null) ?? null,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder)
    return {
      seasonId: row.season_id as string,
      format: (row.format as string) ?? 'bracket',
      title: (row.title as string) ?? '',
      status: (row.status as string) ?? 'draft',
      lockAt: (row.lock_at as string | null) ?? null,
      seeds: Array.isArray(config.seeds) ? config.seeds : [],
      matches,
    }
  })

  const approvedTeamIds = (approvedTeams ?? []).map((team) => team.id)
  const approvedCaptainMap = new Map<
    string,
    { display_name: string | null; email: string | null }
  >()
  const approvedRosterCountMap = new Map<string, number>()
  const approvedRosterMap = new Map<
    string,
    Array<{
      profile_id: string
      role: string
      riot_id_base: string | null
      display_name: string | null
      email: string | null
    }>
  >()

  if (approvedTeamIds.length > 0) {
    const { data: rosterRows, error: rosterError } = await supabaseAdmin
      .from('team_memberships')
      .select('id, team_id, profile_id, player_name, role')
      .in('team_id', approvedTeamIds)
      .eq('is_active', true)
      .is('left_at', null)

    if (rosterError) {
      console.error('Error fetching team roster:', rosterError)
    } else {
      const profileIds = Array.from(
        new Set(
          (rosterRows ?? []).map((r) => r.profile_id).filter((id): id is string => Boolean(id))
        )
      )
      const profileById = new Map<string, RosterProfileRow>()
      if (profileIds.length > 0) {
        const { data: profileRows, error: profilesError } = await supabaseAdmin
          .from('profiles')
          .select('id, display_name, email, riot_id_base')
          .in('id', profileIds)

        if (profilesError) {
          console.error('Error fetching roster profiles:', profilesError)
        } else {
          for (const p of profileRows ?? []) profileById.set(p.id, p)
        }
      }

      for (const row of rosterRows ?? []) {
        approvedRosterCountMap.set(row.team_id, (approvedRosterCountMap.get(row.team_id) ?? 0) + 1)
        const p = profileById.get(row.profile_id)
        const rosterEntry = {
          membership_id: row.id,
          profile_id: row.profile_id,
          player_name: (row as { player_name?: string | null }).player_name ?? null,
          role: row.role,
          riot_id_base: p?.riot_id_base ?? null,
          display_name: p?.display_name ?? null,
          email: p?.email ?? null,
        }
        const current = approvedRosterMap.get(row.team_id) ?? []
        current.push(rosterEntry)
        approvedRosterMap.set(row.team_id, current)

        if (row.role === 'captain') {
          approvedCaptainMap.set(row.team_id, {
            display_name: p?.display_name ?? null,
            email: p?.email ?? null,
          })
        }
      }
    }
  }

  const withLogoUrl = (teams: { id: string; logo_path?: string | null }[]) =>
    teams.map((team) => ({
      ...team,
      logo_url: getTeamLogoUrl(team),
      captain_profile: approvedCaptainMap.get(team.id) ?? null,
      roster_count: approvedRosterCountMap.get(team.id) ?? 0,
      roster: approvedRosterMap.get(team.id) ?? [],
    }))

  let matchesQuery = supabaseAdmin.from('matches').select(
    `
      id,
      season_id,
      stage,
      status,
      approval_status,
      best_of,
      scheduled_at,
      ended_at,
      metadata,
      team_a_id,
      team_b_id,
      winner_team_id,
      team_a_score,
      team_b_score,
      team_a:teams!matches_team_a_id_fkey (id, name, tag),
      team_b:teams!matches_team_b_id_fkey (id, name, tag)
    `
  )

  if (activeSeason) {
    matchesQuery = matchesQuery.eq('season_id', activeSeason.id)
  }

  const [
    { data: disbandedTeams, error: disbandedTeamsError },
    { data: matches, error: matchesError },
  ] = await Promise.all([
    supabaseAdmin
      .from('teams')
      .select(
        `
      id,
      name,
      tag,
      logo_path,
      metadata,
      status,
      approval_status,
      created_at
    `
      )
      .eq('status', 'disbanded')
      .order('created_at', { ascending: false }),
    matchesQuery.order('scheduled_at', { ascending: true, nullsFirst: false }),
  ])

  if (disbandedTeamsError) {
    console.error('Error fetching disbanded teams:', disbandedTeamsError)
  }

  const disbandedWithLogos = (disbandedTeams ?? []).map((team) => ({
    ...team,
    logo_url: team.logo_path
      ? supabaseAdmin.storage.from('team-logos').getPublicUrl(team.logo_path).data.publicUrl
      : null,
    captain_profile: null,
    roster_count: 0,
    roster: [],
  }))

  if (matchesError) {
    console.error('Error fetching matches:', matchesError)
  }

  const matchIds = (matches ?? []).map((match) => match.id)
  let streamsByMatch: Record<string, MatchStreamRow[]> = {}
  if (matchIds.length > 0) {
    const { data: streams, error: streamsError } = await supabaseAdmin
      .from('match_streams')
      .select('id, match_id, platform, stream_url, is_primary, status, metadata')
      .in('match_id', matchIds)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true })

    if (streamsError) {
      console.error('Error fetching match streams:', streamsError)
    } else {
      streamsByMatch = ((streams ?? []) as MatchStreamRow[]).reduce(
        (acc, stream) => {
          if (!acc[stream.match_id]) acc[stream.match_id] = []
          acc[stream.match_id].push(stream)
          return acc
        },
        {} as Record<string, MatchStreamRow[]>
      )
    }
  }

  // Leaderboard imports an admin can pin as a season's final standings.
  const { data: leaderboardBatchRows } = await supabaseAdmin
    .from('stat_import_batches')
    .select('id, display_name, source_filename, created_at, metadata')
    .filter('metadata->>import_type', 'eq', 'leaderboard_entries')
    .eq('status', 'applied')
    .order('created_at', { ascending: false })
    .limit(50)

  // Map art for the Seasons tab's map-pool picker. A failed fetch yields an
  // empty list, which the picker treats as "unavailable" rather than erroring.
  const valorantMaps = (await getValorantMapList()).map((map) => ({
    displayName: map.displayName,
    listViewIcon: map.listViewIcon,
  }))

  const leaderboardBatches = (leaderboardBatchRows ?? []).map((batch) => ({
    id: batch.id,
    label:
      batch.metadata?.display_name ??
      batch.display_name ??
      batch.source_filename ??
      new Date(batch.created_at).toLocaleDateString(),
  }))

  return {
    users: users || [],
    seasons: (seasons ?? []).map((season) => ({
      ...season,
      logo_url: getSeasonLogoUrl(season),
    })),
    leaderboardBatches,
    valorantMaps,
    approvedTeams: withLogoUrl(approvedTeams || []),
    seasonTeams: seasonTeams ?? [],
    seasonMatches: seasonMatches ?? [],
    pickems,
    disbandedTeams: disbandedWithLogos,
    matches: (matches ?? []).map((match) => ({
      ...match,
      streams: streamsByMatch[match.id] ?? [],
      vod_url: match.metadata?.youtube_vod_url ?? null,
      designation: match.metadata?.designation ?? null,
    })),
    activeSeasonId: activeSeason?.id ?? null,
  }
}
