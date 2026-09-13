import { supabaseAdmin } from '$lib/supabase/admin'
import { normalizeImportKey, normalizeBaseName } from '$lib/server/imports/matching'

/**
 * Substitute (sub) detection for a match.
 *
 * A player is a sub when they played in a match for a team but were not on that
 * team's roster for the match's season. That is derived from team_memberships;
 * `match_player_subs` stores only the admin overrides that force the answer when
 * the roster data is incomplete or wrong.
 */

export type SubOverride = {
  id: string
  match_id: string
  puuid: string | null
  player_name: string | null
  is_sub: boolean
  note: string | null
}

/** A team's season roster, as the keys sub detection can match against. */
export type TeamRoster = { profileIds: Set<string>; names: Set<string>; puuids: Set<string> }
export type RosterSets = Map<string, TeamRoster>

/**
 * Every name form a player might appear under, for roster matching. Stat rows
 * carry the full Riot id ("Name#TAG") while the roster stores whatever was typed
 * at team creation — often just the base. Indexing both the tagged form and the
 * tag-stripped base on each side is what lets a rostered player match instead of
 * being mistaken for a sub.
 */
function nameKeys(value: string | null | undefined): string[] {
  const full = normalizeImportKey(value)
  const base = normalizeBaseName(value)
  return [full, base].filter(Boolean)
}

/**
 * Roster membership for the given teams in one season, keyed by team id. Scoped
 * to `seasonId` because rosters are season-scoped and a player can carry an
 * active membership from another season (see team-memberships-active-across-seasons);
 * the match's own season is what selects the right lineup. When the match has no
 * season, every active membership on the team is used instead.
 */
export async function loadRosterSets(
  seasonId: string | null | undefined,
  teamIds: Array<string | null | undefined>
): Promise<RosterSets> {
  const ids = Array.from(new Set(teamIds.filter((id): id is string => Boolean(id))))
  const sets: RosterSets = new Map()
  for (const id of ids) sets.set(id, { profileIds: new Set(), names: new Set(), puuids: new Set() })
  if (ids.length === 0) return sets

  // Select the puuid column when present; fall back to a puuid-less query so the
  // page still works before the team_memberships.puuid migration is applied.
  const runQuery = (columns: string) => {
    let query = supabaseAdmin
      .from('team_memberships')
      .select(columns)
      .in('team_id', ids)
      .eq('is_active', true)
      .is('left_at', null)
    if (seasonId) query = query.eq('season_id', seasonId)
    return query
  }

  type MemberRow = {
    team_id: string
    profile_id: string | null
    player_name: string | null
    puuid?: string | null
  }
  let result = await runQuery('team_id, profile_id, player_name, puuid')
  if (result.error) result = await runQuery('team_id, profile_id, player_name')
  if (result.error) throw new Error('Failed to load team rosters for sub detection')
  const data = (result.data ?? []) as unknown as MemberRow[]

  const profileToTeams = new Map<string, string[]>()
  for (const row of data) {
    const set = sets.get(row.team_id as string)
    if (!set) continue
    if (row.profile_id) {
      set.profileIds.add(row.profile_id as string)
      const list = profileToTeams.get(row.profile_id as string) ?? []
      list.push(row.team_id as string)
      profileToTeams.set(row.profile_id as string, list)
    }
    if (row.puuid) set.puuids.add(row.puuid as string)
    for (const key of nameKeys(row.player_name as string | null)) set.names.add(key)
  }

  // A roster slot may store only a profile link while stats arrive under a name
  // (or vice versa). Fold each rostered profile's known names into its team's
  // name set so name-based stat rows still match the roster and are not
  // mistaken for subs.
  const profileIds = Array.from(profileToTeams.keys())
  if (profileIds.length > 0) {
    const [{ data: profiles }, { data: riotAccounts }] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('id, riot_id_base, display_name, stats_player_name, riot_puuid')
        .in('id', profileIds),
      supabaseAdmin
        .from('profile_riot_accounts')
        .select('profile_id, riot_name, riot_tag, riot_puuid')
        .in('profile_id', profileIds),
    ])
    const addToProfileTeams = (profileId: string, keys: string[], puuid: string | null) => {
      for (const teamId of profileToTeams.get(profileId) ?? []) {
        const set = sets.get(teamId)
        if (!set) continue
        for (const key of keys) set.names.add(key)
        if (puuid) set.puuids.add(puuid)
      }
    }
    for (const profile of profiles ?? []) {
      addToProfileTeams(
        profile.id as string,
        [
          ...nameKeys(profile.riot_id_base as string | null),
          ...nameKeys(profile.display_name as string | null),
          ...nameKeys((profile as { stats_player_name?: string | null }).stats_player_name),
        ],
        (profile as { riot_puuid?: string | null }).riot_puuid ?? null
      )
    }
    // Every registered Riot account (primary and alts) is a name and PUUID the
    // player may appear under in the stats.
    for (const account of riotAccounts ?? []) {
      const name = account.riot_name as string | null
      const tag = account.riot_tag as string | null
      const full = name && tag ? `${name}#${tag}` : name
      addToProfileTeams(
        account.profile_id as string,
        [...nameKeys(full), ...nameKeys(name)],
        (account.riot_puuid as string | null) ?? null
      )
    }
  }
  return sets
}

export async function loadMatchSubOverrides(matchId: string): Promise<SubOverride[]> {
  const { data, error } = await supabaseAdmin
    .from('match_player_subs')
    .select('id, match_id, puuid, player_name, is_sub, note')
    .eq('match_id', matchId)
  // Non-fatal: overrides are an additive layer on top of the roster-derived
  // default. If the table is missing (migration not yet applied) or the query
  // fails, fall back to auto detection rather than breaking the match page.
  if (error) {
    console.warn('loadMatchSubOverrides failed, using auto detection only:', error.message)
    return []
  }
  return (data ?? []) as SubOverride[]
}

/** Overrides for many matches at once, grouped by match id. */
export async function loadSubOverridesForMatches(
  matchIds: Array<string | null | undefined>
): Promise<Map<string, SubOverride[]>> {
  const out = new Map<string, SubOverride[]>()
  const ids = Array.from(new Set(matchIds.filter((id): id is string => Boolean(id))))
  if (ids.length === 0) return out

  const { data, error } = await supabaseAdmin
    .from('match_player_subs')
    .select('id, match_id, puuid, player_name, is_sub, note')
    .in('match_id', ids)
  // Non-fatal, as in loadMatchSubOverrides — fall back to auto detection.
  if (error) {
    console.warn('loadSubOverridesForMatches failed, using auto detection only:', error.message)
    return out
  }
  for (const row of (data ?? []) as SubOverride[]) {
    const list = out.get(row.match_id) ?? []
    list.push(row)
    out.set(row.match_id, list)
  }
  return out
}

/** The explicit override for one source account, or null when none is set. */
export function overrideFor(
  overrides: SubOverride[],
  puuid: string | null | undefined,
  playerName: string | null | undefined
): boolean | null {
  if (puuid) {
    const byPuuid = overrides.find((o) => o.puuid && o.puuid === puuid)
    if (byPuuid) return byPuuid.is_sub
  }
  // Overrides are stored against the exact source-account name, so match on the
  // exact (case-insensitive) name rather than the tag-stripped base.
  const name = normalizeImportKey(playerName)
  if (name) {
    const byName = overrides.find((o) => !o.puuid && normalizeImportKey(o.player_name) === name)
    if (byName) return byName.is_sub
  }
  return null
}

/**
 * The auto rule: on the team's season roster → starter; otherwise → sub. An
 * unknown or empty roster returns false — with no roster on record there is
 * nothing to judge against, and flagging everyone as a sub would be worse than
 * flagging no one.
 */
export function autoIsSub(
  roster: TeamRoster | undefined,
  profileId: string | null | undefined,
  playerName: string | null | undefined,
  puuid?: string | null | undefined
): boolean {
  if (
    !roster ||
    (roster.profileIds.size === 0 && roster.names.size === 0 && roster.puuids.size === 0)
  ) {
    return false
  }
  // PUUID is the exact identity match and wins over any name coincidence.
  if (puuid && roster.puuids.has(puuid)) return false
  if (profileId && roster.profileIds.has(profileId)) return false
  if (nameKeys(playerName).some((key) => roster.names.has(key))) return false
  return true
}

/** Combined verdict: an override wins, otherwise the auto rule decides. */
export function resolveIsSub(args: {
  overrides: SubOverride[]
  roster: TeamRoster | undefined
  profileId: string | null | undefined
  playerName: string | null | undefined
  puuid?: string | null | undefined
}): boolean {
  const forced = overrideFor(args.overrides, args.puuid, args.playerName)
  if (forced !== null) return forced
  return autoIsSub(args.roster, args.profileId, args.playerName, args.puuid)
}

/**
 * Create or update a sub override for one source account in a match, or clear
 * it (return to the auto rule) when `isSub` is null.
 */
export async function setMatchSubOverride(opts: {
  matchId: string
  puuid: string | null
  playerName: string | null
  isSub: boolean | null
  note?: string | null
  createdByProfileId: string
}): Promise<void> {
  const { matchId, puuid, playerName, isSub } = opts
  if (!puuid && !playerName) throw new Error('A puuid or player name is required')

  const { data: existing } = await supabaseAdmin
    .from('match_player_subs')
    .select('id')
    .eq('match_id', matchId)
    .eq(puuid ? 'puuid' : 'player_name', (puuid ?? playerName) as string)
    .maybeSingle()

  // Null clears the override — delete the row so the auto rule takes over again.
  if (isSub === null) {
    if (existing?.id) {
      const { error } = await supabaseAdmin.from('match_player_subs').delete().eq('id', existing.id)
      if (error) throw new Error('Failed to clear sub override')
    }
    return
  }

  const payload = {
    match_id: matchId,
    puuid,
    player_name: playerName,
    is_sub: isSub,
    note: opts.note ?? null,
    created_by_profile_id: opts.createdByProfileId,
  }

  if (existing?.id) {
    const { error } = await supabaseAdmin
      .from('match_player_subs')
      .update(payload)
      .eq('id', existing.id)
    if (error) throw new Error('Failed to update sub override')
  } else {
    const { error } = await supabaseAdmin.from('match_player_subs').insert(payload)
    if (error) throw new Error('Failed to create sub override')
  }
}
