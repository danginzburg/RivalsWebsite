import { error } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { buildProfileMatcher, getProfilesForImports } from '$lib/server/imports/matching'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeKey(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeBase(value: string): string {
  return value.split('#')[0]?.trim().toLowerCase()
}

function parseNumber(value: string): number {
  const n = Number(String(value ?? '').trim())
  return Number.isFinite(n) ? n : 0
}

function parsePercent(value: string): number {
  const cleaned = String(value ?? '')
    .replace('%', '')
    .trim()
  return parseNumber(cleaned)
}

const DETAILED_EXPECTED_HEADERS = [
  'PLAYER',
  'AGENTS',
  'GAMES',
  'W',
  'L',
  'ROUNDS',
  'RW',
  'RL',
  'ACS',
  'KD',
  'KAST',
  'ADR',
  'K',
  'KPG',
  'KPR',
  'D',
  'DPG',
  'DPR',
  'A',
  'APG',
  'APR',
  'FK',
  'FKPG',
  'FD',
  'FDPG',
  'HS%',
  'PLANTS',
  'PLANTS/G',
  'DEFUSES',
  'DEFUSES/G',
  'ECON',
]

const COMPACT_EXPECTED_HEADERS = [
  'AGENT',
  'PLAYER',
  'AVG COMBAT SCORE',
  'K',
  'D',
  'A',
  'K/D',
  'ADR',
  'KAST',
  'FK',
  'FD',
  'FDD',
  'HS%',
  'PLANTS',
  'DEFUSES',
  'ECON RATING',
]

function isDetailedHeaders(headers: string[]): boolean {
  return DETAILED_EXPECTED_HEADERS.every((col, i) => headers[i]?.trim().toUpperCase() === col)
}

function isCompactHeaders(headers: string[]): boolean {
  return COMPACT_EXPECTED_HEADERS.every((col, i) => headers[i]?.trim().toUpperCase() === col)
}

type ParsedRow = {
  player_name: string
  agents: string
  games: number
  games_won: number
  games_lost: number
  rounds: number
  rounds_won: number
  rounds_lost: number
  acs: number
  kd: number
  kast_pct: number
  adr: number
  kills: number
  kpg: number
  kpr: number
  deaths: number
  dpg: number
  dpr: number
  assists: number
  apg: number
  apr: number
  fk: number
  fkpg: number
  fd: number
  fdpg: number
  hs_pct: number
  plants: number
  plants_per_game: number
  defuses: number
  defuses_per_game: number
  econ_rating: number
  matched_profile_id: string | null
  side?: 'a' | 'b'
}

function parseMapCsv(text: string, profileMap: Map<string, string>): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) throw error(400, 'CSV must include a header and at least one data row')

  const headers = lines[0].split(',').map((h) => h.trim())
  const detailedFormat = isDetailedHeaders(headers)
  const compactFormat = isCompactHeaders(headers)

  if (!detailedFormat && !compactFormat) {
    throw error(400, 'CSV headers do not match the expected format')
  }

  const out: ParsedRow[] = []

  if (compactFormat) {
    const playerLines: string[] = []
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',').map((part) => part.trim())
      const hasAnyValue = parts.some((part) => part.length > 0)
      if (!hasAnyValue) continue
      if (parts[2] && !Number.isFinite(Number(parts[2]))) break
      playerLines.push(lines[i])
    }

    const half = Math.ceil(playerLines.length / 2)
    for (let i = 0; i < playerLines.length; i++) {
      const parts = playerLines[i].split(',').map((part) => part.trim())
      const playerName = parts[1] ?? ''
      if (!playerName) continue

      const matched_profile_id =
        profileMap.get(normalizeKey(playerName)) ??
        profileMap.get(normalizeBase(playerName)) ??
        null

      const side = i < half ? 'a' : 'b'
      out.push({
        player_name: playerName,
        agents: parts[0] ?? '',
        games: 1,
        games_won: 0,
        games_lost: 0,
        rounds: 0,
        rounds_won: 0,
        rounds_lost: 0,
        acs: parseNumber(parts[2]),
        kd: parseNumber(parts[6]),
        kast_pct: parsePercent(parts[8]),
        adr: parseNumber(parts[7]),
        kills: parseNumber(parts[3]),
        kpg: parseNumber(parts[3]),
        kpr: 0,
        deaths: parseNumber(parts[4]),
        dpg: parseNumber(parts[4]),
        dpr: 0,
        assists: parseNumber(parts[5]),
        apg: parseNumber(parts[5]),
        apr: 0,
        fk: parseNumber(parts[9]),
        fkpg: parseNumber(parts[9]),
        fd: parseNumber(parts[10]),
        fdpg: parseNumber(parts[10]),
        hs_pct: parsePercent(parts[12]),
        plants: parseNumber(parts[13]),
        plants_per_game: parseNumber(parts[13]),
        defuses: parseNumber(parts[14]),
        defuses_per_game: parseNumber(parts[14]),
        econ_rating: parseNumber(parts[15]),
        matched_profile_id,
        side,
      })
    }

    if (out.length === 0) throw error(400, 'No player rows found in CSV')
    return out
  }

  for (let i = 1; i < lines.length; i++) {
    // Ignore the round differential line that sometimes appears.
    if (lines[i].startsWith(',,,,2,-2')) continue

    const parts = lines[i].split(',')
    const playerName = parts[0]?.trim()
    if (!playerName) {
      // Likely footer/summary rows.
      continue
    }

    const matched_profile_id =
      profileMap.get(normalizeKey(playerName)) ?? profileMap.get(normalizeBase(playerName)) ?? null

    out.push({
      player_name: playerName,
      agents: parts[1]?.trim() ?? '',
      games: parseNumber(parts[2]),
      games_won: parseNumber(parts[3]),
      games_lost: parseNumber(parts[4]),
      rounds: parseNumber(parts[5]),
      rounds_won: parseNumber(parts[6]),
      rounds_lost: parseNumber(parts[7]),
      acs: parseNumber(parts[8]),
      kd: parseNumber(parts[9]),
      kast_pct: parsePercent(parts[10]),
      adr: parseNumber(parts[11]),
      kills: parseNumber(parts[12]),
      kpg: parseNumber(parts[13]),
      kpr: parseNumber(parts[14]),
      deaths: parseNumber(parts[15]),
      dpg: parseNumber(parts[16]),
      dpr: parseNumber(parts[17]),
      assists: parseNumber(parts[18]),
      apg: parseNumber(parts[19]),
      apr: parseNumber(parts[20]),
      fk: parseNumber(parts[21]),
      fkpg: parseNumber(parts[22]),
      fd: parseNumber(parts[23]),
      fdpg: parseNumber(parts[24]),
      hs_pct: parsePercent(parts[25]),
      plants: parseNumber(parts[26]),
      plants_per_game: parseNumber(parts[27]),
      defuses: parseNumber(parts[28]),
      defuses_per_game: parseNumber(parts[29]),
      econ_rating: parseNumber(parts[30]),
      matched_profile_id,
    })
  }

  if (out.length === 0) throw error(400, 'No player rows found in CSV')
  return out
}

export const load: PageServerLoad = async ({ locals, params }) => {
  await requireAdmin(locals.user)

  const matchId = params.id
  if (!UUID_RE.test(matchId)) throw error(404, 'Match not found')

  const { data: match, error: matchError } = await supabaseAdmin
    .from('matches')
    .select(
      `
      id,
      status,
      approval_status,
      best_of,
      scheduled_at,
      team_a_id,
      team_b_id,
      metadata,
      team_a:teams!matches_team_a_id_fkey (id, name, tag),
      team_b:teams!matches_team_b_id_fkey (id, name, tag)
    `
    )
    .eq('id', matchId)
    .maybeSingle()

  if (matchError || !match) throw error(404, 'Match not found')

  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, riot_id_base')
    .order('display_name', { ascending: true })

  let maps: any[] = []
  const { data: matchMaps, error: mapsError } = await supabaseAdmin
    .from('match_maps')
    .select('id, map_order, map_name, team_a_rounds, team_b_rounds, source_filename, created_at')
    .eq('match_id', matchId)
    .order('map_order', { ascending: true })

  if (!mapsError) {
    maps = matchMaps ?? []
  }

  return {
    match,
    profiles: profiles ?? [],
    existingMaps: maps,
  }
}

export const actions: Actions = {
  importMap: async ({ locals, params, request }) => {
    const admin = await requireAdmin(locals.user)

    const matchId = params.id
    if (!UUID_RE.test(matchId)) throw error(404, 'Match not found')

    const form = await request.formData()
    const file = form.get('csv')
    if (!(file instanceof File)) throw error(400, 'Missing CSV file')
    if (!file.name.toLowerCase().endsWith('.csv')) throw error(400, 'Please upload a .csv file')

    const mapOrder = Number(form.get('mapOrder') ?? '')
    if (!Number.isFinite(mapOrder) || mapOrder < 1) throw error(400, 'Invalid map order')

    const mapNameRaw = String(form.get('mapName') ?? '').trim()
    const mapName = mapNameRaw.length ? mapNameRaw : null

    const teamARoundsRaw = String(form.get('teamARounds') ?? '').trim()
    const teamBRoundsRaw = String(form.get('teamBRounds') ?? '').trim()
    const teamARounds = teamARoundsRaw.length ? Number(teamARoundsRaw) : null
    const teamBRounds = teamBRoundsRaw.length ? Number(teamBRoundsRaw) : null
    if (!Number.isFinite(teamARounds ?? NaN) || !Number.isFinite(teamBRounds ?? NaN)) {
      throw error(400, 'Team rounds are required')
    }

    const { data: match, error: matchError } = await supabaseAdmin
      .from('matches')
      .select('id, team_a_id, team_b_id')
      .eq('id', matchId)
      .maybeSingle()
    if (matchError || !match) throw error(404, 'Match not found')

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('match_maps')
      .select('id')
      .eq('match_id', matchId)
      .eq('map_order', mapOrder)
      .maybeSingle()
    if (existingError && String((existingError as any).message ?? '').includes('match_maps')) {
      throw error(500, 'match_maps table missing; apply Supabase migrations first')
    }
    const profiles = await getProfilesForImports()
    const profileMatcher = buildProfileMatcher(profiles)
    const profileMap = new Map<string, string>()
    for (const profile of profiles) {
      const id = profile.id
      for (const candidate of [
        profile.riot_id_base,
        profile.display_name,
        profile.stats_player_name,
      ]) {
        if (!candidate) continue
        profileMap.set(normalizeKey(candidate), id)
        profileMap.set(normalizeBase(candidate), id)
      }
    }

    const text = await file.text()
    const parsed = parseMapCsv(text, profileMap)

    for (const row of parsed) {
      if (!row.matched_profile_id) {
        row.matched_profile_id = profileMatcher.resolve(row.player_name)
      }
    }

    const unmatched = parsed.filter((r) => !r.matched_profile_id).map((r) => r.player_name)

    const profileIds = parsed.map((r) => r.matched_profile_id!).filter(Boolean)
    const { data: memberships } = await supabaseAdmin
      .from('team_memberships')
      .select('profile_id, team_id')
      .in('profile_id', profileIds)
      .in('team_id', [match.team_a_id, match.team_b_id])
      .eq('is_active', true)
      .is('left_at', null)

    const teamByProfileId = new Map<string, string>()
    for (const m of memberships ?? []) {
      teamByProfileId.set(m.profile_id, m.team_id)
    }

    let matchMapId: string
    if (existing?.id) {
      const { error: clearMapStatsError } = await supabaseAdmin
        .from('player_match_map_stats')
        .delete()
        .eq('match_map_id', existing.id)

      if (clearMapStatsError) throw error(500, 'Failed to clear existing map stats')

      const { data: updatedMap, error: updateMapError } = await supabaseAdmin
        .from('match_maps')
        .update({
          map_name: mapName,
          team_a_rounds: teamARounds,
          team_b_rounds: teamBRounds,
          imported_by_profile_id: admin.id,
          source_filename: file.name,
          metadata: {
            imported_at: new Date().toISOString(),
          },
        })
        .eq('id', existing.id)
        .select('id')
        .single()

      if (updateMapError) throw error(500, 'Failed to update existing match map row')
      matchMapId = updatedMap.id
    } else {
      const { data: createdMap, error: createMapError } = await supabaseAdmin
        .from('match_maps')
        .insert({
          match_id: matchId,
          map_order: mapOrder,
          map_name: mapName,
          team_a_rounds: teamARounds,
          team_b_rounds: teamBRounds,
          imported_by_profile_id: admin.id,
          source_filename: file.name,
          metadata: {
            imported_at: new Date().toISOString(),
          },
        })
        .select('id')
        .single()

      if (createMapError && String((createMapError as any).message ?? '').includes('match_maps')) {
        throw error(500, 'match_maps table missing; apply Supabase migrations first')
      }
      if (createMapError || !createdMap) throw error(500, 'Failed to create match map row')
      matchMapId = createdMap.id
    }

    const rowsToInsert = parsed.map((r) => {
      const profileId = r.matched_profile_id
      const teamId =
        r.side === 'a'
          ? match.team_a_id
          : r.side === 'b'
            ? match.team_b_id
            : profileId
              ? (teamByProfileId.get(profileId) ?? null)
              : null
      return {
        match_map_id: matchMapId,
        match_id: matchId,
        profile_id: profileId,
        team_id: teamId,
        player_name: r.player_name,
        agents: r.agents,
        games: r.games,
        games_won: r.games_won,
        games_lost: r.games_lost,
        rounds: r.rounds,
        rounds_won: r.rounds_won,
        rounds_lost: r.rounds_lost,
        acs: r.acs,
        kd: r.kd,
        kast_pct: r.kast_pct,
        adr: r.adr,
        kills: r.kills,
        deaths: r.deaths,
        assists: r.assists,
        fk: r.fk,
        fd: r.fd,
        hs_pct: r.hs_pct,
        econ_rating: r.econ_rating,
        kpg: r.kpg,
        kpr: r.kpr,
        dpg: r.dpg,
        dpr: r.dpr,
        apg: r.apg,
        apr: r.apr,
        fkpg: r.fkpg,
        fdpg: r.fdpg,
        plants: r.plants,
        plants_per_game: r.plants_per_game,
        defuses: r.defuses,
        defuses_per_game: r.defuses_per_game,
      }
    })

    const { error: insertError } = await supabaseAdmin
      .from('player_match_map_stats')
      .insert(rowsToInsert)
    if (
      insertError &&
      String((insertError as any).message ?? '').includes('player_match_map_stats')
    ) {
      throw error(500, 'player_match_map_stats table missing; apply Supabase migrations first')
    }
    if (insertError) throw error(500, 'Failed to insert player map stats')

    return { success: true }
  },
}
