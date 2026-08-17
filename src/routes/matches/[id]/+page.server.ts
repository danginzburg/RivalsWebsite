import { error } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { average, sum, weightedAverage } from '$lib/server/math'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { loadCommentThread } from '$lib/server/comments'
import { getViewerProfileId } from '$lib/server/auth/viewer'
import { getSeasonStandingsRanks } from '$lib/server/leaderboard/ranks'
import { getValorantMapLookup, parseVetoLine, type VetoStep } from '$lib/server/valorant/maps'

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
  const isAdmin = locals.user?.role === 'admin'
  const viewerProfileId = await getViewerProfileId(locals.user)

  const { data: match, error: matchError } = await supabaseAdmin
    .from('matches')
    .select(
      `
      id,
      season_id,
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
        .select('*')
        .eq('match_id', matchId)
        .order('map_order', { ascending: true }),
      supabaseAdmin
        .from('player_match_map_stats')
        .select(
          'match_map_id, profile_id, team_id, player_name, agents, acs, kills, deaths, assists, kd, adr, kast_pct, hs_pct, econ_rating, rounds, fk, fd, plants, defuses, mk_2k, mk_3k, mk_4k, mk_5k, clutches_won, clutches_attempted, metadata'
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
            row.player_name ?? profile?.display_name ?? profile?.riot_id_base ?? 'Player',
          profile_name: profile?.display_name ?? profile?.riot_id_base ?? null,
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
          // Null on CSV-imported maps, which never had these counted. The UI
          // shows a dash for those rather than a misleading zero.
          mk_2k: row.mk_2k ?? null,
          mk_3k: row.mk_3k ?? null,
          mk_4k: row.mk_4k ?? null,
          mk_5k: row.mk_5k ?? null,
          clutches_won: row.clutches_won ?? null,
          clutches_attempted: row.clutches_attempted ?? null,
          // Riot puuid keys the head-to-head grid; the breakdown sizes clutches.
          puuid: (row.metadata as Record<string, unknown> | null)?.puuid as string | null,
          duels: ((row.metadata as Record<string, unknown> | null)?.duels ?? null) as Record<
            string,
            number
          > | null,
          clutch_breakdown: ((row.metadata as Record<string, unknown> | null)?.clutch_breakdown ??
            null) as ClutchBreakdown | null,
        }
      })

    const meta = map.metadata as Record<string, unknown> | null | undefined
    const mapForfeit = meta?.forfeit as { forfeiting_team_id?: string; label?: string } | undefined

    return {
      id: map.id,
      map_order: map.map_order,
      map_label: `Map ${map.map_order}`,
      map_name: map.map_name ?? null,
      team_a_rounds: map.team_a_rounds ?? 0,
      team_b_rounds: map.team_b_rounds ?? 0,
      is_voided: (map as any).is_voided ?? false,
      stats: rows,
      forfeit: mapForfeit ?? null,
    }
  })

  const teamARow = Array.isArray(match.team_a) ? match.team_a[0] : match.team_a
  const teamBRow = Array.isArray(match.team_b) ? match.team_b[0] : match.team_b

  function nameForTeamId(teamId: string | null | undefined): string | null {
    if (!teamId) return null
    if (teamARow && (teamARow as { id?: string }).id === teamId)
      return (teamARow as { name?: string }).name ?? null
    if (teamBRow && (teamBRow as { id?: string }).id === teamId)
      return (teamBRow as { name?: string }).name ?? null
    return null
  }

  const matchMeta = match.metadata as Record<string, unknown> | null
  const rawForfeit = matchMeta?.forfeit as
    | {
        kind?: string
        forfeiting_team_id?: string
        reason?: string
        map_notes?: Record<string, string>
      }
    | undefined

  const forfeitDisplay =
    rawForfeit?.kind === 'admin_award' || rawForfeit?.kind === 'no_show'
      ? {
          kind: rawForfeit.kind as 'admin_award' | 'no_show',
          forfeitingTeamName: nameForTeamId(rawForfeit.forfeiting_team_id),
          reason: typeof rawForfeit.reason === 'string' ? rawForfeit.reason : null,
          winnerTeamName: nameForTeamId(match.winner_team_id),
        }
      : null

  const normalizedMapsWithForfeitNames = normalizedMaps.map((m) => ({
    ...m,
    forfeit: m.forfeit
      ? {
          forfeiting_team_id: m.forfeit.forfeiting_team_id,
          label: m.forfeit.label,
          forfeiting_team_name: nameForTeamId(m.forfeit.forfeiting_team_id),
        }
      : null,
  }))

  type MapStatRow = (typeof normalizedMapsWithForfeitNames)[number]['stats'][number]
  const totalByPlayer = new Map<string, MapStatRow[]>()
  for (const map of normalizedMapsWithForfeitNames) {
    if (map.is_voided) continue
    for (const row of map.stats) {
      const key = normalizePlayerKey(row.team_id, row.profile_id, row.player_name)
      const current = totalByPlayer.get(key) ?? []
      current.push(row)
      totalByPlayer.set(key, current)
    }
  }

  /** Clutch wins and attempts, each keyed by how many opponents were alive. */
  type ClutchBreakdown = {
    won: Record<string, number>
    attempted: Record<string, number>
  }

  /** Advanced-stat row shape, as loaded from `player_match_map_stats`. */
  type AdvancedRow = {
    mk_2k: number | null
    mk_3k: number | null
    mk_4k: number | null
    mk_5k: number | null
    clutches_won: number | null
    clutches_attempted: number | null
    puuid: string | null
    duels: Record<string, number> | null
    clutch_breakdown: ClutchBreakdown | null
  }

  /**
   * Series totals for the stats only the Riot import records.
   *
   * Counts add up; the duel map and clutch breakdown are merged key by key.
   * A stat null on every map stays null, so a CSV-imported series shows a dash
   * instead of claiming nobody ever got an ace.
   */
  function sumAdvanced(rows: AdvancedRow[]) {
    const addCounts = (key: keyof AdvancedRow) => {
      const present = rows.map((row) => row[key] as number | null).filter((v) => v !== null)
      return present.length > 0 ? present.reduce((a, b) => a + b, 0) : null
    }

    const mergeDuels = () => {
      const merged: Record<string, number> = {}
      let sawAny = false
      for (const row of rows) {
        if (!row.duels) continue
        sawAny = true
        for (const [k, v] of Object.entries(row.duels)) merged[k] = (merged[k] ?? 0) + v
      }
      return sawAny ? merged : null
    }

    /** `{ won, attempted }`, each keyed 1–5, summed across the maps. */
    const mergeClutchBreakdown = (): ClutchBreakdown | null => {
      const merged: ClutchBreakdown = { won: {}, attempted: {} }
      let sawAny = false
      for (const row of rows) {
        const value = row.clutch_breakdown
        if (!value) continue
        sawAny = true
        for (const half of ['won', 'attempted'] as const) {
          for (const [size, count] of Object.entries(value[half] ?? {})) {
            merged[half][size] = (merged[half][size] ?? 0) + count
          }
        }
      }
      return sawAny ? merged : null
    }

    return {
      mk_2k: addCounts('mk_2k'),
      mk_3k: addCounts('mk_3k'),
      mk_4k: addCounts('mk_4k'),
      mk_5k: addCounts('mk_5k'),
      clutches_won: addCounts('clutches_won'),
      clutches_attempted: addCounts('clutches_attempted'),
      // The same player keeps one puuid across the series.
      puuid: rows.find((row) => row.puuid)?.puuid ?? null,
      duels: mergeDuels(),
      clutch_breakdown: mergeClutchBreakdown(),
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
    // Advanced stats add across maps rather than averaging — a series 5K count
    // is how many aces there were, not aces per map. Stays null when no map
    // recorded them, so "not counted" survives the aggregation.
    ...sumAdvanced(rows),
  }))

  const hasRealStats = totalStats.length > 0

  const comments = await loadCommentThread('match', matchId, {
    includeReportCounts: isAdmin,
    viewerProfileId,
  })
  const seeds = await getSeasonStandingsRanks((match as { season_id?: string | null }).season_id)

  // Resolve each free-text veto line to a Valorant map + its art, so the page
  // can show the maps rather than a list of strings. Only fetched when a veto
  // exists; unrecognized lines keep their text and simply render without art.
  const rawVetoes = Array.isArray(matchMeta?.map_vetoes) ? (matchMeta.map_vetoes as string[]) : []
  let mapVetoes: VetoStep[] = []
  if (rawVetoes.length > 0) {
    const mapLookup = await getValorantMapLookup()
    mapVetoes = rawVetoes.map((line) => parseVetoLine(line, mapLookup))
  }

  return {
    viewer: { isAdmin, profileId: viewerProfileId },
    comments,
    seeds,
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
      designation: (matchMeta?.designation as string | null) ?? null,
      map_vetoes: mapVetoes,
      maps: normalizedMapsWithForfeitNames,
      forfeit_display: forfeitDisplay,
      total_stats: totalStats,
      has_real_stats: hasRealStats,
    },
  }
}
