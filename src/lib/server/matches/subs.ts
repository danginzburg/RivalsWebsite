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

/** One roster stint: a membership row with the moments it covered. */
export type Stint = {
  id: number
  team_id: string
  profile_id: string | null
  player_name: string | null
  puuid: string | null
  /** When the player joined (epoch ms), or null when unknown. */
  joinedMs: number | null
  /** When the player left (epoch ms, exclusive), or null while still on it. */
  leftMs: number | null
  /** True when this is the player's earliest real stint in the season. */
  first: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * A membership join/leave value as epoch ms. Rows are stored as timestamps, but
 * a bare calendar day (written before the column carried a time) still reads
 * correctly: a join covers that whole day and a departure takes effect at the
 * end of it, which is what the day-precision rows meant.
 */
export function membershipMoment(
  value: string | null | undefined,
  edge: 'join' | 'leave'
): number | null {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const midnight = Date.parse(`${value}T00:00:00Z`)
    return edge === 'leave' ? midnight + DAY_MS : midnight
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * A stint closed within a day of opening: a roster mis-entry, or a slot that
 * was replaced straight away. It still covers matches inside its own window,
 * but it is never treated as the player's first stint (see stintCovers) and
 * history displays leave it out.
 */
export function isShortStint(
  joinedAt: string | null | undefined,
  leftAt: string | null | undefined
): boolean {
  const joined = membershipMoment(joinedAt, 'join')
  const left = membershipMoment(leftAt, 'leave')
  return joined !== null && left !== null && left - joined <= DAY_MS
}

/**
 * The moment (epoch ms) a match counts as played for roster purposes.
 * scheduled_at wins because imports stamp ended_at with the time of the import,
 * not of the game.
 */
export function matchRosterTime(match: {
  scheduled_at?: string | null
  ended_at?: string | null
}): number | null {
  const raw = match.scheduled_at ?? match.ended_at ?? null
  if (!raw) return null
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Whether a stint had the player on the team at `time`.
 *
 * Removing a player, moving them, or disbanding their team closes the row
 * (left_at) instead of deleting it. Judging each match against the stints that
 * covered the moment it was played keeps the player main roster for the
 * matches already played, while matches after the departure no longer count
 * them.
 *
 * - A stint covers matches from joined_at up to, but not including, left_at.
 * - joined_at is only trusted for a player's later stints. Past seasons are
 *   backfilled after the fact, so a player's first roster row routinely carries
 *   a joined_at long after the matches it covers; the first stint therefore
 *   reaches back to the start of the season.
 * - With no time, only open stints count (the current roster).
 */
export function stintCovers(stint: Stint, time: number | null): boolean {
  if (time === null) return stint.leftMs === null
  if (stint.leftMs !== null && time >= stint.leftMs) return false
  if (!stint.first && stint.joinedMs !== null && time < stint.joinedMs) return false
  return true
}

function stintIdentity(stint: Pick<Stint, 'profile_id' | 'puuid' | 'player_name'>): string {
  if (stint.profile_id) return `p:${stint.profile_id}`
  if (stint.puuid) return `u:${stint.puuid}`
  return `n:${normalizeImportKey(stint.player_name)}`
}

/** Every roster stint for a set of teams in one season, readable at any moment. */
export type RosterTimeline = {
  /** Roster sets at `time` (epoch ms, see matchRosterTime); null means the current roster. */
  at(time: number | null): RosterSets
}

/**
 * Roster history for the given teams in one season. Scoped to `seasonId`
 * because rosters are season-scoped and a player can carry an active membership
 * from another season (see team-memberships-active-across-seasons); the match's
 * own season is what selects the right lineup. When the match has no season,
 * every membership on the team is used instead.
 */
export async function loadRosterTimeline(
  seasonId: string | null | undefined,
  teamIds: Array<string | null | undefined>
): Promise<RosterTimeline> {
  const ids = Array.from(new Set(teamIds.filter((id): id is string => Boolean(id))))
  const empty = (): RosterSets => {
    const sets: RosterSets = new Map()
    for (const id of ids) {
      sets.set(id, { profileIds: new Set(), names: new Set(), puuids: new Set() })
    }
    return sets
  }
  if (ids.length === 0) return { at: empty }

  // Closed stints are included: a row with left_at is history, not garbage. A
  // row deactivated without a left_at has no dates to place it, so it is the
  // only kind left out. The whole season is read (not just these teams) so a
  // player's earliest stint is known even when it was on another team.
  // Select the puuid column when present; fall back to a puuid-less query so the
  // page still works before the team_memberships.puuid migration is applied.
  const runQuery = (columns: string) => {
    const query = supabaseAdmin
      .from('team_memberships')
      .select(columns)
      .or('is_active.eq.true,left_at.not.is.null')
    return seasonId ? query.eq('season_id', seasonId) : query.in('team_id', ids)
  }

  type MemberRow = {
    id: number
    team_id: string
    profile_id: string | null
    player_name: string | null
    puuid?: string | null
    joined_at: string | null
    left_at: string | null
  }
  const base = 'id, team_id, profile_id, player_name, joined_at, left_at'
  let result = await runQuery(`${base}, puuid`)
  if (result.error) result = await runQuery(base)
  if (result.error) throw new Error('Failed to load team rosters for sub detection')
  const rows = (result.data ?? []) as unknown as MemberRow[]

  // A short stint is never a player's first: left eligible, a mis-entry would
  // reach back across the whole season.
  const earliestByIdentity = new Map<string, { id: number; joined: number }>()
  for (const row of rows) {
    if (isShortStint(row.joined_at, row.left_at)) continue
    const key = stintIdentity({ ...row, puuid: row.puuid ?? null })
    const current = earliestByIdentity.get(key)
    const joined = membershipMoment(row.joined_at, 'join') ?? Number.NEGATIVE_INFINITY
    if (
      !current ||
      joined < current.joined ||
      (joined === current.joined && Number(row.id) < Number(current.id))
    ) {
      earliestByIdentity.set(key, { id: row.id, joined })
    }
  }
  const firstIds = new Set(Array.from(earliestByIdentity.values()).map((row) => row.id))

  const teamSet = new Set(ids)
  const stints: Stint[] = rows
    .filter((row) => teamSet.has(row.team_id))
    .map((row) => ({
      id: row.id,
      team_id: row.team_id,
      profile_id: row.profile_id ?? null,
      player_name: row.player_name ?? null,
      puuid: row.puuid ?? null,
      joinedMs: membershipMoment(row.joined_at, 'join'),
      leftMs: membershipMoment(row.left_at, 'leave'),
      first: firstIds.has(row.id),
    }))

  // A roster slot may store only a profile link while stats arrive under a name
  // (or vice versa). Each rostered profile's known names and PUUIDs are gathered
  // once here and folded into whichever team it covers on a given date, so
  // name-based stat rows still match the roster and are not mistaken for subs.
  const profileKeys = new Map<string, { names: string[]; puuids: string[] }>()
  const profileIds = Array.from(
    new Set(stints.map((s) => s.profile_id).filter((id): id is string => Boolean(id)))
  )
  if (profileIds.length > 0) {
    const [{ data: profiles }, { data: riotAccounts }] = await Promise.all([
      supabaseAdmin.from('profiles').select('id, display_name').in('id', profileIds),
      supabaseAdmin
        .from('riot_accounts')
        .select('profile_id, riot_name, riot_tag, puuid')
        .in('profile_id', profileIds),
    ])
    const addKeys = (profileId: string, keys: string[], puuid: string | null) => {
      const entry = profileKeys.get(profileId) ?? { names: [], puuids: [] }
      entry.names.push(...keys)
      if (puuid) entry.puuids.push(puuid)
      profileKeys.set(profileId, entry)
    }
    for (const profile of profiles ?? []) {
      addKeys(profile.id as string, nameKeys(profile.display_name as string | null), null)
    }
    // Every registered Riot account (primary, alts, aliases) is a name and PUUID the
    // player may appear under in the stats.
    for (const account of riotAccounts ?? []) {
      const name = account.riot_name as string | null
      const tag = account.riot_tag as string | null
      const full = name && tag ? `${name}#${tag}` : name
      addKeys(
        account.profile_id as string,
        [...nameKeys(full), ...nameKeys(name)],
        (account.puuid as string | null) ?? null
      )
    }
  }

  return {
    at(time) {
      const sets = empty()
      for (const stint of stints) {
        if (!stintCovers(stint, time)) continue
        const set = sets.get(stint.team_id)
        if (!set) continue
        if (stint.puuid) set.puuids.add(stint.puuid)
        for (const key of nameKeys(stint.player_name)) set.names.add(key)
        if (stint.profile_id) {
          set.profileIds.add(stint.profile_id)
          const keys = profileKeys.get(stint.profile_id)
          for (const key of keys?.names ?? []) set.names.add(key)
          for (const puuid of keys?.puuids ?? []) set.puuids.add(puuid)
        }
      }
      return sets
    },
  }
}

/**
 * Roster membership for the given teams in one season at `time` (when the match
 * was played, see matchRosterTime), keyed by team id. Without a time this is the
 * current roster.
 */
export async function loadRosterSets(
  seasonId: string | null | undefined,
  teamIds: Array<string | null | undefined>,
  time: number | null = null
): Promise<RosterSets> {
  return (await loadRosterTimeline(seasonId, teamIds)).at(time)
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
