import { supabaseAdmin } from '$lib/supabase/admin'
import {
  baseNameKey,
  buildIdentityIndex,
  loadApprovedRiotAccounts,
  loadProfileNames,
  normalizeNameKey,
} from '$lib/server/players/identity'
import { average, sum } from '$lib/server/math'

type TeamRow = {
  id: string
  name: string
  tag: string | null
  metadata?: Record<string, unknown> | null
  approval_status?: string | null
}

export type { ProfileRow, RiotAccountRow } from '$lib/server/players/identity'

/** Kept as aliases: the normalization lives with the identity resolver. */
export const normalizeImportKey = normalizeNameKey
export const normalizeBaseName = baseNameKey

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
 * See `$lib/server/players/identity` for the rules.
 */
export const buildProfileMatcher = buildIdentityIndex

/**
 * A looser key for team names: accents, spacing and punctuation dropped, so a
 * sheet's "2FNTASTIC2FURIOUS" or "Krüise Esports" still finds
 * "2FNTASTIC 2FURIOUS" / "Kruise Esports".
 */
function compactTeamKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export function buildTeamMatcher(teams: TeamRow[]) {
  const byMatchName = new Map<string, TeamRow>()
  const byLeaderboardTag = new Map<string, TeamRow>()
  // Compact keys are only trusted when one team owns them; `null` marks a
  // key two teams share, which must not resolve to either.
  const byCompactName = new Map<string, TeamRow | null>()
  const addCompact = (key: string, team: TeamRow) => {
    if (!key) return
    const existing = byCompactName.get(key)
    if (existing === undefined) byCompactName.set(key, team)
    else if (existing && existing.id !== team.id) byCompactName.set(key, null)
  }

  for (const team of teams) {
    const nameKey = normalizeImportKey(team.name)
    if (nameKey) byMatchName.set(nameKey, team)
    addCompact(compactTeamKey(team.name), team)

    const tagKey = normalizeImportKey(team.tag)
    if (tagKey) byLeaderboardTag.set(tagKey, team)

    for (const alias of metadataStringList(team.metadata ?? null, 'match_import_names')) {
      const aliasKey = normalizeImportKey(alias)
      if (aliasKey) byMatchName.set(aliasKey, team)
      addCompact(compactTeamKey(alias), team)
    }

    for (const alias of metadataStringList(team.metadata ?? null, 'leaderboard_import_tags')) {
      const aliasKey = normalizeImportKey(alias)
      if (aliasKey) byLeaderboardTag.set(aliasKey, team)
    }
  }

  return {
    byMatchName(name: string): TeamRow | null {
      return (
        byMatchName.get(normalizeImportKey(name)) ?? byCompactName.get(compactTeamKey(name)) ?? null
      )
    },
    byLeaderboardTag(tag: string): TeamRow | null {
      return byLeaderboardTag.get(normalizeImportKey(tag)) ?? null
    },
  }
}

/**
 * Approved teams for name matching. Pass `seasonId` to match only that season's
 * teams: team names carry over between seasons, so an unscoped lookup can
 * resolve a backfilled match onto the same-named team from another season.
 */
export async function getApprovedTeamsForImports(seasonId?: string | null) {
  let query = supabaseAdmin
    .from('teams')
    .select('id, name, tag, metadata, approval_status')
    .eq('approval_status', 'approved')
  if (seasonId) query = query.eq('season_id', seasonId)

  const { data, error } = await query
  if (error) throw new Error('Failed to load teams')
  return (data ?? []) as TeamRow[]
}

export const getProfilesForImports = loadProfileNames

/** Approved, owned Riot accounts (primary, alts, aliases) for profile matching. */
export function getRiotAccountsForImports() {
  return loadApprovedRiotAccounts()
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
 * When the profile later gains a Riot account or alias, we can relink those
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
