import { error } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { average, sum, weightedAverage } from '$lib/server/math'
import { getTeamLogoUrl } from '$lib/server/teams/logo'

function normalizePlayerKey(
  teamId: string | null | undefined,
  profileId: string | null | undefined,
  playerName: string | null | undefined
) {
  return `${teamId ?? 'team'}:${
    profileId ??
    String(playerName ?? '')
      .trim()
      .toLowerCase()
  }`
}

export const load = async ({ params, locals }: { params: { id: string }; locals: App.Locals }) => {
  const matchId = params.id
  if (!matchId) throw error(400, 'Missing match id')

  const { data: match, error: matchError } = await supabaseAdmin
    .from('matches')
    .select(
      `
      id,
      status,
      approval_status,
      best_of,
      scheduled_at,
      started_at,
      ended_at,
      team_a_id,
      team_b_id,
      team_a_score,
      team_b_score,
      winner_team_id,
      metadata,
      team_a:teams!matches_team_a_id_fkey (id, name, tag, logo_path),
      team_b:teams!matches_team_b_id_fkey (id, name, tag, logo_path)
    `
    )
    .eq('id', matchId)
    .maybeSingle()

  if (matchError || !match) throw error(404, 'Match not found')
  if (match.approval_status !== 'approved') throw error(404, 'Match not found')

  const { data: streams } = await supabaseAdmin
    .from('match_streams')
    .select('id, match_id, platform, stream_url, is_primary, status, created_at, metadata')
    .eq('match_id', matchId)
    .order('is_primary', { ascending: false })

  const [{ data: maps, error: mapsError }, { data: mapStats, error: mapStatsError }] =
    await Promise.all([
      supabaseAdmin
        .from('match_maps')
        .select('id, map_order, map_name, team_a_rounds, team_b_rounds')
        .eq('match_id', matchId)
        .order('map_order', { ascending: true }),
      supabaseAdmin
        .from('player_match_map_stats')
        .select(
          'match_map_id, profile_id, team_id, player_name, agents, acs, kills, deaths, assists, kd, adr, kast_pct, hs_pct, econ_rating, rounds, fk, fd, plants, defuses'
        )
        .eq('match_id', matchId),
    ])

  if (mapsError) throw error(500, 'Failed to load match maps')
  if (mapStatsError) throw error(500, 'Failed to load match map stats')

  const profileIds = Array.from(
    new Set((mapStats ?? []).map((row) => row.profile_id).filter((id): id is string => Boolean(id)))
  )
  const profileById = new Map<
    string,
    { id: string; riot_id_base: string | null; display_name: string | null }
  >()

  if (profileIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('id, riot_id_base, display_name')
      .in('id', profileIds)

    if (profilesError) throw error(500, 'Failed to load match player profiles')
    for (const profile of profiles ?? []) {
      profileById.set(profile.id, profile)
    }
  }

  const normalizedMaps = (maps ?? []).map((map) => {
    const rows = (mapStats ?? [])
      .filter((row) => row.match_map_id === map.id)
      .map((row) => {
        const profile = row.profile_id ? profileById.get(row.profile_id) : null
        const fallbackRounds = Number(map.team_a_rounds ?? 0) + Number(map.team_b_rounds ?? 0)
        const rowRounds = Number(row.rounds ?? 0)
        return {
          profile_id: row.profile_id,
          team_id: row.team_id,
          player_name:
            row.player_name ?? profile?.riot_id_base ?? profile?.display_name ?? 'Player',
          profile_name: profile?.riot_id_base ?? profile?.display_name ?? null,
          agents: row.agents ?? null,
          acs: row.acs,
          kills: row.kills,
          deaths: row.deaths,
          assists: row.assists,
          kd: row.kd,
          adr: row.adr,
          kast_pct: row.kast_pct,
          hs_pct: row.hs_pct,
          econ_rating: row.econ_rating,
          rounds: rowRounds > 0 ? rowRounds : fallbackRounds,
          fk: row.fk,
          fd: row.fd,
          plants: row.plants,
          defuses: row.defuses,
        }
      })

    return {
      id: map.id,
      map_order: map.map_order,
      map_label: `Map ${map.map_order}`,
      map_name: map.map_name ?? null,
      team_a_rounds: map.team_a_rounds ?? 0,
      team_b_rounds: map.team_b_rounds ?? 0,
      stats: rows,
    }
  })

  const totalByPlayer = new Map<string, any[]>()
  for (const map of normalizedMaps) {
    for (const row of map.stats) {
      const key = normalizePlayerKey(row.team_id, row.profile_id, row.player_name)
      const current = totalByPlayer.get(key) ?? []
      current.push(row)
      totalByPlayer.set(key, current)
    }
  }

  const totalStats = Array.from(totalByPlayer.values()).map((rows) => ({
    profile_id: rows[0].profile_id,
    team_id: rows[0].team_id,
    player_name: rows[0].player_name,
    profile_name: rows[0].profile_name,
    agents: Array.from(
      new Set(
        rows
          .flatMap((row) => String(row.agents ?? '').split(/\s+/))
          .map((value) => value.trim())
          .filter(Boolean)
      )
    ).join(' '),
    acs: average(rows.map((row) => row.acs)),
    kills: sum(rows.map((row) => row.kills)),
    deaths: sum(rows.map((row) => row.deaths)),
    assists: sum(rows.map((row) => row.assists)),
    kd: sum(rows.map((row) => row.kills)) / Math.max(sum(rows.map((row) => row.deaths)), 1),
    adr: weightedAverage(rows, 'adr', 'rounds'),
    kast_pct: weightedAverage(rows, 'kast_pct', 'rounds'),
    hs_pct: average(rows.map((row) => row.hs_pct)),
    econ_rating: average(rows.map((row) => row.econ_rating)),
    fk: sum(rows.map((row) => row.fk)),
    fd: sum(rows.map((row) => row.fd)),
    kpg: sum(rows.map((row) => row.kills)) / Math.max(rows.length, 1),
    kpr: sum(rows.map((row) => row.kills)) / Math.max(sum(rows.map((row) => row.rounds)), 1),
    dpg: sum(rows.map((row) => row.deaths)) / Math.max(rows.length, 1),
    dpr: sum(rows.map((row) => row.deaths)) / Math.max(sum(rows.map((row) => row.rounds)), 1),
    apg: sum(rows.map((row) => row.assists)) / Math.max(rows.length, 1),
    apr: sum(rows.map((row) => row.assists)) / Math.max(sum(rows.map((row) => row.rounds)), 1),
    fkpg: sum(rows.map((row) => row.fk)) / Math.max(rows.length, 1),
    fdpg: sum(rows.map((row) => row.fd)) / Math.max(rows.length, 1),
    plants_per_game: sum(rows.map((row) => row.plants)) / Math.max(rows.length, 1),
    defuses_per_game: sum(rows.map((row) => row.defuses)) / Math.max(rows.length, 1),
  }))

  return {
    match: {
      ...match,
      team_a: match.team_a
        ? {
            ...(Array.isArray(match.team_a) ? match.team_a[0] : match.team_a),
            logo_url: getTeamLogoUrl(Array.isArray(match.team_a) ? match.team_a[0] : match.team_a),
          }
        : null,
      team_b: match.team_b
        ? {
            ...(Array.isArray(match.team_b) ? match.team_b[0] : match.team_b),
            logo_url: getTeamLogoUrl(Array.isArray(match.team_b) ? match.team_b[0] : match.team_b),
          }
        : null,
      streams: streams ?? [],
      vod_url: match.metadata?.youtube_vod_url ?? null,
      maps: normalizedMaps,
      total_stats: totalStats,
    },
  }
}
