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
  riot_puuid?: string | null
}

/**
 * A Riot account owned by a profile (primary or alt). PUUID is the stable key
 * that survives a rename, so it takes priority over any name when matching.
 */
export type RiotAccountRow = {
  profile_id: string
  riot_name: string
  riot_tag?: string | null
  riot_puuid?: string | null
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

/**
 * Resolve an imported player row to a profile, by PUUID first and then by name.
 *
 * PUUID wins because it survives Riot renames, so a player who changed their
 * name still matches. Names are the fallback for rows that carry no PUUID (CSV
 * imports, un-verified accounts). Explicit `profile_riot_accounts` rows are
 * layered over the legacy profile name columns and take precedence on a clash,
 * since they are a deliberate identity rather than an incidental name.
 */
export function buildProfileMatcher(profiles: ProfileRow[], accounts: RiotAccountRow[] = []) {
  const byKey = new Map<string, string>()
  const byPuuid = new Map<string, string>()

  const addName = (name: string | null | undefined, profileId: string) => {
    if (!name) return
    const full = normalizeImportKey(name)
    const base = normalizeBaseName(name)
    if (full) byKey.set(full, profileId)
    if (base) byKey.set(base, profileId)
  }

  // Legacy profile name columns first, so explicit account rows can overwrite.
  for (const profile of profiles) {
    addName(profile.riot_id_base, profile.id)
    addName(profile.display_name, profile.id)
    addName(profile.stats_player_name, profile.id)
    if (profile.riot_puuid) byPuuid.set(profile.riot_puuid, profile.id)
  }

  for (const account of accounts) {
    if (account.riot_puuid) byPuuid.set(account.riot_puuid, account.profile_id)
    const nameTag = account.riot_tag
      ? `${account.riot_name}#${account.riot_tag}`
      : account.riot_name
    addName(nameTag, account.profile_id)
    addName(account.riot_name, account.profile_id)
  }

  return {
    resolve(playerName: string, puuid?: string | null): string | null {
      if (puuid) {
        const byP = byPuuid.get(puuid)
        if (byP) return byP
      }
      return (
        byKey.get(normalizeImportKey(playerName)) ??
        byKey.get(normalizeBaseName(playerName)) ??
        null
      )
    },
    resolveByPuuid(puuid: string): string | null {
      return byPuuid.get(puuid) ?? null
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
    .select('id, display_name, riot_id_base, stats_player_name, riot_puuid')

  if (error) throw new Error('Failed to load profiles')
  return (data ?? []) as ProfileRow[]
}

/**
 * Approved Riot accounts (primary + alts) for profile matching. Pending and
 * rejected rows are excluded so an unverified claim cannot capture stats.
 */
export async function getRiotAccountsForImports() {
  const { data, error } = await supabaseAdmin
    .from('profile_riot_accounts')
    .select('profile_id, riot_name, riot_tag, riot_puuid')
    .eq('status', 'approved')

  if (error) throw new Error('Failed to load Riot accounts')
  return (data ?? []) as RiotAccountRow[]
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

function quoteOrValue(value: string): string {
  // PostgREST filter syntax supports quoted values.
  // Double quotes inside are escaped by doubling.
  return `"${value.replaceAll('"', '""')}"`
}

/**
 * Backfill player_match_map_stats.profile_id for previously-imported map stats.
 *
 * Match imports commonly arrive before the player has claimed their Riot base name.
 * When the profile later sets riot_id_base/stats_player_name, we can relink those
 * historic imported rows and rebuild player_match_stats so match history appears
 * on the claimed player page.
 */
export async function rematchPlayerMatchMapStatsForBase(profileId: string, baseName: string) {
  const base = String(baseName ?? '').trim()
  if (!base) return { updated: 0, rebuiltMatches: 0 }

  const baseQuoted = quoteOrValue(base)
  const baseTagLikeQuoted = quoteOrValue(`${base}#%`)

  const { data: updatedRows, error: updateError } = await supabaseAdmin
    .from('player_match_map_stats')
    .update({ profile_id: profileId })
    .is('profile_id', null)
    .or(
      `player_name.eq.${baseQuoted},player_name.ilike.${baseQuoted},player_name.ilike.${baseTagLikeQuoted}`
    )
    .select('match_id')

  if (updateError) {
    console.warn(
      'rematchPlayerMatchMapStatsForBase update failed:',
      updateError.message,
      updateError.details,
      updateError.hint
    )
    return { updated: 0, rebuiltMatches: 0 }
  }

  const matchIds = Array.from(
    new Set((updatedRows ?? []).map((r: any) => String(r.match_id ?? '')).filter(Boolean))
  )

  for (const matchId of matchIds) {
    await rebuildPlayerMatchStats(matchId)
  }

  return { updated: (updatedRows ?? []).length, rebuiltMatches: matchIds.length }
}

export async function rebuildPlayerMatchStats(matchId: string) {
  const { data: mapStats, error: mapStatsError } = await supabaseAdmin
    .from('player_match_map_stats')
    .select(
      'profile_id, team_id, player_name, agents, games, games_won, games_lost, rounds, rounds_won, rounds_lost, acs, kd, kast_pct, adr, kills, deaths, assists, fk, fd, hs_pct, econ_rating, kpg, kpr, dpg, dpr, apg, apr, fkpg, fdpg, plants, plants_per_game, defuses, defuses_per_game'
    )
    .eq('match_id', matchId)

  if (mapStatsError) throw new Error('Failed to load imported map stats')

  type MapStatRow = NonNullable<typeof mapStats>[number]
  const grouped = new Map<string, MapStatRow[]>()
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
