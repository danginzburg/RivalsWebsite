import { supabaseAdmin } from '$lib/supabase/admin'
import { average, sum } from '$lib/server/math'

type TeamRow = {
  id: string
  name: string
  tag: string | null
  metadata?: Record<string, unknown> | null
  approval_status?: string | null
}

export type ProfileRow = {
  id: string
  display_name: string | null
  riot_id_base: string | null
  stats_player_name?: string | null
}

export function normalizeImportKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function normalizeBaseName(value: unknown): string {
  return normalizeImportKey(String(value ?? '').split('#')[0] ?? '')
}

function metadataStringList(
  metadata: Record<string, unknown> | null | undefined,
  key: string
): string[] {
  const raw = metadata?.[key]
  if (!Array.isArray(raw)) return []
  return raw.map((value) => String(value ?? '').trim()).filter(Boolean)
}

export function buildProfileMatcher(profiles: ProfileRow[]) {
  const byKey = new Map<string, string>()

  for (const profile of profiles) {
    if (profile.riot_id_base) {
      const full = normalizeImportKey(profile.riot_id_base)
      const base = normalizeBaseName(profile.riot_id_base)
      if (full) byKey.set(full, profile.id)
      if (base) byKey.set(base, profile.id)
    }

    if (profile.display_name) {
      const full = normalizeImportKey(profile.display_name)
      const base = normalizeBaseName(profile.display_name)
      if (full) byKey.set(full, profile.id)
      if (base) byKey.set(base, profile.id)
    }

    if (profile.stats_player_name) {
      const full = normalizeImportKey(profile.stats_player_name)
      const base = normalizeBaseName(profile.stats_player_name)
      if (full) byKey.set(full, profile.id)
      if (base) byKey.set(base, profile.id)
    }
  }

  return {
    resolve(playerName: string): string | null {
      return (
        byKey.get(normalizeImportKey(playerName)) ??
        byKey.get(normalizeBaseName(playerName)) ??
        null
      )
    },
  }
}

export function buildTeamMatcher(teams: TeamRow[]) {
  const byMatchName = new Map<string, TeamRow>()
  const byLeaderboardTag = new Map<string, TeamRow>()

  for (const team of teams) {
    const nameKey = normalizeImportKey(team.name)
    if (nameKey) byMatchName.set(nameKey, team)

    const tagKey = normalizeImportKey(team.tag)
    if (tagKey) byLeaderboardTag.set(tagKey, team)

    for (const alias of metadataStringList(team.metadata ?? null, 'match_import_names')) {
      const aliasKey = normalizeImportKey(alias)
      if (aliasKey) byMatchName.set(aliasKey, team)
    }

    for (const alias of metadataStringList(team.metadata ?? null, 'leaderboard_import_tags')) {
      const aliasKey = normalizeImportKey(alias)
      if (aliasKey) byLeaderboardTag.set(aliasKey, team)
    }
  }

  return {
    byMatchName(name: string): TeamRow | null {
      return byMatchName.get(normalizeImportKey(name)) ?? null
    },
    byLeaderboardTag(tag: string): TeamRow | null {
      return byLeaderboardTag.get(normalizeImportKey(tag)) ?? null
    },
  }
}

export async function getApprovedTeamsForImports() {
  const { data, error } = await supabaseAdmin
    .from('teams')
    .select('id, name, tag, metadata, approval_status')
    .eq('approval_status', 'approved')

  if (error) throw new Error('Failed to load teams')
  return (data ?? []) as TeamRow[]
}

export async function getProfilesForImports() {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, riot_id_base, stats_player_name')

  if (error) throw new Error('Failed to load profiles')
  return (data ?? []) as ProfileRow[]
}

export function parseMatchCsvDate(value: string): string {
  const raw = String(value ?? '').trim()
  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (dmy) {
    const year = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3])
    const month = Number(dmy[2])
    const day = Number(dmy[1])
    const iso = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
    if (Number.isFinite(iso.getTime())) return iso.toISOString()
  }

  const parsed = new Date(raw)
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error('Invalid match date in CSV')
  }
  return parsed.toISOString()
}

export async function rebuildPlayerMatchStats(matchId: string) {
  const { data: mapStats, error: mapStatsError } = await supabaseAdmin
    .from('player_match_map_stats')
    .select(
      'profile_id, team_id, player_name, agents, games, games_won, games_lost, rounds, rounds_won, rounds_lost, acs, kd, kast_pct, adr, kills, deaths, assists, fk, fd, hs_pct, econ_rating, kpg, kpr, dpg, dpr, apg, apr, fkpg, fdpg, plants, plants_per_game, defuses, defuses_per_game'
    )
    .eq('match_id', matchId)

  if (mapStatsError) throw new Error('Failed to load imported map stats')

  const grouped = new Map<string, any[]>()
  for (const row of mapStats ?? []) {
    if (!row.profile_id || !row.team_id) continue
    const current = grouped.get(row.profile_id) ?? []
    current.push(row)
    grouped.set(row.profile_id, current)
  }

  const rows = Array.from(grouped.entries()).map(([profileId, entries]) => ({
    match_id: matchId,
    profile_id: profileId,
    team_id: entries[0].team_id,
    status: 'approved',
    reviewed_at: new Date().toISOString(),
    agents: Array.from(
      new Set(
        entries
          .flatMap((entry) => String(entry.agents ?? '').split(/\s+/))
          .map((value) => value.trim())
          .filter(Boolean)
      )
    ).join(' '),
    games: sum(entries.map((entry) => entry.games)),
    games_won: sum(entries.map((entry) => entry.games_won)),
    games_lost: sum(entries.map((entry) => entry.games_lost)),
    rounds: sum(entries.map((entry) => entry.rounds)),
    rounds_won: sum(entries.map((entry) => entry.rounds_won)),
    rounds_lost: sum(entries.map((entry) => entry.rounds_lost)),
    acs: average(entries.map((entry) => entry.acs)),
    kd: average(entries.map((entry) => entry.kd)),
    kast_pct: average(entries.map((entry) => entry.kast_pct)),
    adr: average(entries.map((entry) => entry.adr)),
    kills: sum(entries.map((entry) => entry.kills)),
    deaths: sum(entries.map((entry) => entry.deaths)),
    assists: sum(entries.map((entry) => entry.assists)),
    fk: sum(entries.map((entry) => entry.fk)),
    fd: sum(entries.map((entry) => entry.fd)),
    hs_pct: average(entries.map((entry) => entry.hs_pct)),
    econ_rating: average(entries.map((entry) => entry.econ_rating)),
    kpg: average(entries.map((entry) => entry.kpg)),
    kpr: average(entries.map((entry) => entry.kpr)),
    dpg: average(entries.map((entry) => entry.dpg)),
    dpr: average(entries.map((entry) => entry.dpr)),
    apg: average(entries.map((entry) => entry.apg)),
    apr: average(entries.map((entry) => entry.apr)),
    fkpg: average(entries.map((entry) => entry.fkpg)),
    fdpg: average(entries.map((entry) => entry.fdpg)),
    plants: sum(entries.map((entry) => entry.plants)),
    plants_per_game: average(entries.map((entry) => entry.plants_per_game)),
    defuses: sum(entries.map((entry) => entry.defuses)),
    defuses_per_game: average(entries.map((entry) => entry.defuses_per_game)),
    metadata: {
      imported_from_map_stats: true,
      player_name: entries[0].player_name ?? null,
      map_count: entries.length,
    },
  }))

  await supabaseAdmin.from('player_match_stats').delete().eq('match_id', matchId)

  if (rows.length === 0) return

  const { error: insertError } = await supabaseAdmin.from('player_match_stats').insert(rows)
  if (insertError) throw new Error('Failed to rebuild series player stats')
}
