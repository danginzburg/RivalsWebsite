import { supabaseAdmin } from '$lib/supabase/admin'
import {
  buildProfileMatcher,
  rebuildPlayerMatchStats,
  type ProfileRow,
  type RiotAccountRow,
} from '$lib/server/imports/matching'

/** Approved Riot accounts (primary + alts) owned by one profile. */
async function getProfileRiotAccounts(profileId: string): Promise<RiotAccountRow[]> {
  const { data } = await supabaseAdmin
    .from('profile_riot_accounts')
    .select('profile_id, riot_name, riot_tag, riot_puuid')
    .eq('profile_id', profileId)
    .eq('status', 'approved')
  return (data ?? []) as RiotAccountRow[]
}

/** Every name a profile is known by, across legacy columns and Riot accounts. */
function profileNamesWithAccounts(profile: ProfileRow, accounts: RiotAccountRow[]): string[] {
  const names = [profile.display_name, profile.riot_id_base, profile.stats_player_name]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
  for (const account of accounts) {
    if (account.riot_name) {
      names.push(account.riot_name.trim())
      if (account.riot_tag) names.push(`${account.riot_name}#${account.riot_tag}`.trim())
    }
  }
  return Array.from(new Set(names))
}

export type ClaimRelinkResult = {
  teamMembershipsLinked: number
  teamMembershipDuplicatesDeactivated: number
  teamMembershipConflicts: number
  matchMapRowsLinked: number
  matchesRebuilt: number
  rivalsGroupStatsRowsUpdated: number
}

function normalizeMembershipName(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function quoteOrValue(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

/** Normalized keys used for roster matching (same idea as membership.ts). */
export function normalizedProfileNameKeys(profile: ProfileRow): Set<string> {
  return new Set(
    [profile.display_name, profile.riot_id_base, profile.stats_player_name]
      .map((value) => normalizeMembershipName(value))
      .filter(Boolean)
  )
}

/**
 * Link or reconcile name-only team memberships after display/riot/stats names are set.
 *
 * Rosters are exclusive per season, so every rule below applies within the season of
 * the name-only row rather than across the profile's whole history:
 * - No active membership that season: attach the matching name-only row.
 * - Already on that season's team: the name-only row is deactivated as a duplicate.
 * - Already on a different team that season: counted as a conflict (needs admin review).
 */
export async function relinkTeamMembershipsForClaim(profileId: string): Promise<{
  linked: number
  duplicatesDeactivated: number
  conflicts: number
}> {
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, riot_id_base, stats_player_name')
    .eq('id', profileId)
    .maybeSingle()

  if (profileError || !profile) {
    throw new Error('Failed to load profile for team relink')
  }

  const accounts = await getProfileRiotAccounts(profileId)
  const nameKeys = new Set(
    profileNamesWithAccounts(profile as ProfileRow, accounts).map((n) => normalizeMembershipName(n))
  )
  for (const key of normalizedProfileNameKeys(profile as ProfileRow)) nameKeys.add(key)
  if (nameKeys.size === 0) {
    return { linked: 0, duplicatesDeactivated: 0, conflicts: 0 }
  }

  // One active spot per season, so this is a set rather than a single row: a
  // player backfilled into old seasons holds one membership in each.
  const { data: activeMemberships, error: activeErr } = await supabaseAdmin
    .from('team_memberships')
    .select('id, team_id, season_id')
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .is('left_at', null)

  if (activeErr) {
    throw new Error('Failed to load active team membership')
  }

  const { data: nameOnlyRows, error: listErr } = await supabaseAdmin
    .from('team_memberships')
    .select('id, team_id, player_name, profile_id, season_id')
    .is('profile_id', null)
    .eq('is_active', true)
    .is('left_at', null)

  if (listErr) {
    throw new Error('Failed to load named team memberships')
  }

  const matching = (nameOnlyRows ?? []).filter((row) =>
    nameKeys.has(normalizeMembershipName((row as { player_name?: string | null }).player_name))
  )

  const toLink: string[] = []
  const toDeactivate: string[] = []
  let conflicts = 0

  const seasonKey = (value: unknown) => String(value ?? '__none__')
  const linkedSeasons = new Set<string>()
  const activeTeamBySeason = new Map<string, string>()
  for (const row of (activeMemberships ?? []) as Array<{
    team_id?: string | null
    season_id?: string | null
  }>) {
    if (row.team_id) activeTeamBySeason.set(seasonKey(row.season_id), String(row.team_id))
  }

  for (const row of matching) {
    const teamId = String((row as { team_id?: string }).team_id ?? '')
    const activeTeamId = activeTeamBySeason.get(
      seasonKey((row as { season_id?: string | null }).season_id)
    )

    if (!activeTeamId) {
      const season = seasonKey((row as { season_id?: string | null }).season_id)
      if (linkedSeasons.has(season)) {
        // A second candidate in the same season would collide with the first on
        // the per-season unique index, so it goes to review instead.
        conflicts += 1
        continue
      }
      linkedSeasons.add(season)
      toLink.push(String(row.id))
    } else if (teamId === activeTeamId) {
      // Same season, same team: the named slot is a stand-in for the spot the
      // profile already holds, so it retires rather than duplicating it.
      toDeactivate.push(String(row.id))
    } else {
      conflicts += 1
    }
  }

  if (toDeactivate.length > 0) {
    const { error: deactErr } = await supabaseAdmin
      .from('team_memberships')
      .update({ is_active: false, left_at: new Date().toISOString().slice(0, 10) })
      .in('id', toDeactivate)

    if (deactErr) {
      throw new Error('Failed to deactivate duplicate name-only team memberships')
    }
  }

  let linked = 0
  if (toLink.length > 0) {
    const { error: updateError } = await supabaseAdmin
      .from('team_memberships')
      .update({ profile_id: profileId })
      .in('id', toLink)

    if (updateError) {
      throw new Error('Failed to link named team memberships')
    }
    linked = toLink.length
  }

  return {
    linked,
    duplicatesDeactivated: toDeactivate.length,
    conflicts,
  }
}

/**
 * Set profile_id on imported map stat rows where it was null and the CSV name resolves to this profile.
 */
export async function relinkPlayerMatchMapStatsForClaim(profileId: string): Promise<{
  rowsLinked: number
  matchIds: string[]
}> {
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, riot_id_base, stats_player_name, riot_puuid')
    .eq('id', profileId)
    .maybeSingle()

  if (profileError || !profile) {
    throw new Error('Failed to load profile for match map relink')
  }

  const accounts = await getProfileRiotAccounts(profileId)
  const matcher = buildProfileMatcher([profile as ProfileRow], accounts)
  const rawNames = profileNamesWithAccounts(profile as ProfileRow, accounts)
  const puuids = Array.from(
    new Set(
      [profile.riot_puuid, ...accounts.map((a) => a.riot_puuid)]
        .map((v) => String(v ?? '').trim())
        .filter(Boolean)
    )
  )

  if (rawNames.length === 0 && puuids.length === 0) {
    return { rowsLinked: 0, matchIds: [] }
  }

  const orParts: string[] = []
  for (const name of rawNames) {
    const qEq = quoteOrValue(name)
    const base = name.split('#')[0]?.trim() ?? name
    const qBase = quoteOrValue(base)
    const qTag = quoteOrValue(`${base}#%`)
    orParts.push(`player_name.eq.${qEq}`, `player_name.eq.${qBase}`, `player_name.ilike.${qTag}`)
  }
  // Rows imported from Riot carry the source PUUID in metadata; a renamed
  // account still relinks by that key even when no stored name matches.
  for (const puuid of puuids) {
    orParts.push(`metadata->>puuid.eq.${quoteOrValue(puuid)}`)
  }

  const { data: candidates, error: candErr } = await supabaseAdmin
    .from('player_match_map_stats')
    .select('id, match_id, player_name, metadata')
    .is('profile_id', null)
    .or(orParts.join(','))
    .limit(5000)

  if (candErr) {
    throw new Error('Failed to load unmatched player match map stats')
  }

  const puuidSet = new Set(puuids)
  const idsToUpdate: string[] = []
  const matchIds = new Set<string>()

  for (const row of candidates ?? []) {
    const name = String((row as { player_name?: string | null }).player_name ?? '')
    const rowPuuid = (() => {
      const meta = (row as { metadata?: unknown }).metadata
      if (meta && typeof meta === 'object') {
        const p = (meta as Record<string, unknown>).puuid
        return typeof p === 'string' ? p : null
      }
      return null
    })()

    if ((rowPuuid && puuidSet.has(rowPuuid)) || matcher.resolve(name, rowPuuid) === profileId) {
      idsToUpdate.push(String((row as { id: string }).id))
      const mid = (row as { match_id?: string }).match_id
      if (mid) matchIds.add(String(mid))
    }
  }

  if (idsToUpdate.length === 0) {
    return { rowsLinked: 0, matchIds: [] }
  }

  const { error: updErr } = await supabaseAdmin
    .from('player_match_map_stats')
    .update({ profile_id: profileId })
    .in('id', idsToUpdate)

  if (updErr) {
    throw new Error('Failed to update player match map stats with profile id')
  }

  return { rowsLinked: idsToUpdate.length, matchIds: Array.from(matchIds) }
}

export async function syncRivalsGroupStatsByProfileNames(profileId: string): Promise<number> {
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, riot_id_base, stats_player_name, riot_puuid')
    .eq('id', profileId)
    .maybeSingle()

  if (profileError || !profile) {
    throw new Error('Failed to load profile for rivals group stats sync')
  }

  const accounts = await getProfileRiotAccounts(profileId)
  const names = Array.from(new Set(profileNamesWithAccounts(profile as ProfileRow, accounts)))

  let total = 0
  for (const name of names) {
    const base = name.split('#')[0].trim()
    const qName = quoteOrValue(name)
    const qBase = quoteOrValue(base)
    const qTag = quoteOrValue(`${base}#%`)

    const { data: updated, error } = await supabaseAdmin
      .from('rivals_group_stats')
      .update({ profile_id: profileId })
      .is('profile_id', null)
      .or(`player_name.eq.${qName},player_name.eq.${qBase},player_name.ilike.${qTag}`)
      .select('id')

    if (error) {
      console.warn('syncRivalsGroupStatsByProfileNames failed for name:', name, error)
      continue
    }
    total += updated?.length ?? 0
  }

  return total
}

/**
 * Full post-claim relink: roster, per-map match stats, series aggregates, leaderboard imports.
 */
export async function claimRelinkAfterProfileUpdate(profileId: string): Promise<ClaimRelinkResult> {
  const team = await relinkTeamMembershipsForClaim(profileId)
  if (team.conflicts > 0) {
    console.warn(
      `[claimRelink] team membership conflicts (${team.conflicts}) for profile ${profileId} — needs admin review`
    )
  }

  const map = await relinkPlayerMatchMapStatsForClaim(profileId)
  // Rebuild series stats for matches we just linked, and also for any match that already had
  // this profile_id on map rows (e.g. SQL backfill or prior claim) where rebuild never ran.
  const matchIdsToRebuild = new Set<string>(map.matchIds)
  const { data: existingMapRows, error: existingMapErr } = await supabaseAdmin
    .from('player_match_map_stats')
    .select('match_id')
    .eq('profile_id', profileId)

  if (existingMapErr) {
    console.warn('claimRelink: failed to list map stats by profile for rebuild:', existingMapErr)
  } else {
    for (const row of existingMapRows ?? []) {
      const mid = (row as { match_id?: string | null }).match_id
      if (mid) matchIdsToRebuild.add(String(mid))
    }
  }

  for (const matchId of matchIdsToRebuild) {
    try {
      await rebuildPlayerMatchStats(matchId)
    } catch (e) {
      console.warn('rebuildPlayerMatchStats failed:', matchId, e)
    }
  }

  const { error: rpcError } = await supabaseAdmin.rpc('rematch_rivals_group_stats', {
    batch_id: null,
  })
  if (rpcError) {
    console.warn('rematch_rivals_group_stats failed:', rpcError)
  }

  let rivalsExtra = 0
  try {
    rivalsExtra = await syncRivalsGroupStatsByProfileNames(profileId)
  } catch (e) {
    console.warn('syncRivalsGroupStatsByProfileNames failed:', e)
  }

  return {
    teamMembershipsLinked: team.linked,
    teamMembershipDuplicatesDeactivated: team.duplicatesDeactivated,
    teamMembershipConflicts: team.conflicts,
    matchMapRowsLinked: map.rowsLinked,
    matchesRebuilt: matchIdsToRebuild.size,
    rivalsGroupStatsRowsUpdated: rivalsExtra,
  }
}
