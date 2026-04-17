import { supabaseAdmin } from '$lib/supabase/admin'
import {
  buildProfileMatcher,
  rebuildPlayerMatchStats,
  type ProfileRow,
} from '$lib/server/imports/matching'

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
 * - If the profile has no active membership: attach matching name-only rows.
 * - If the profile already has an active membership: same-team name-only rows are deactivated;
 *   name-only rows on a different team are counted as conflicts (need admin review).
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

  const nameKeys = normalizedProfileNameKeys(profile as ProfileRow)
  if (nameKeys.size === 0) {
    return { linked: 0, duplicatesDeactivated: 0, conflicts: 0 }
  }

  const { data: activeMembership, error: activeErr } = await supabaseAdmin
    .from('team_memberships')
    .select('id, team_id')
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .is('left_at', null)
    .maybeSingle()

  if (activeErr) {
    throw new Error('Failed to load active team membership')
  }

  const { data: nameOnlyRows, error: listErr } = await supabaseAdmin
    .from('team_memberships')
    .select('id, team_id, player_name, profile_id')
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

  if (!activeMembership?.team_id) {
    toLink.push(...matching.map((m) => String(m.id)))
  } else {
    const activeTeamId = String(activeMembership.team_id)
    for (const row of matching) {
      const teamId = String((row as { team_id?: string }).team_id ?? '')
      if (teamId === activeTeamId) {
        toDeactivate.push(String(row.id))
      } else {
        conflicts += 1
      }
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
    .select('id, display_name, riot_id_base, stats_player_name')
    .eq('id', profileId)
    .maybeSingle()

  if (profileError || !profile) {
    throw new Error('Failed to load profile for match map relink')
  }

  const matcher = buildProfileMatcher([profile as ProfileRow])
  const rawNames = [profile.display_name, profile.riot_id_base, profile.stats_player_name]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)

  if (rawNames.length === 0) {
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

  const { data: candidates, error: candErr } = await supabaseAdmin
    .from('player_match_map_stats')
    .select('id, match_id, player_name')
    .is('profile_id', null)
    .or(orParts.join(','))
    .limit(5000)

  if (candErr) {
    throw new Error('Failed to load unmatched player match map stats')
  }

  const idsToUpdate: string[] = []
  const matchIds = new Set<string>()

  for (const row of candidates ?? []) {
    const name = String((row as { player_name?: string | null }).player_name ?? '')
    if (matcher.resolve(name) === profileId) {
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
    .select('id, display_name, riot_id_base, stats_player_name')
    .eq('id', profileId)
    .maybeSingle()

  if (profileError || !profile) {
    throw new Error('Failed to load profile for rivals group stats sync')
  }

  const names = Array.from(
    new Set(
      [profile.display_name, profile.riot_id_base, profile.stats_player_name]
        .map((v) => String(v ?? '').trim())
        .filter(Boolean)
    )
  )

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
  for (const matchId of map.matchIds) {
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
    matchesRebuilt: map.matchIds.length,
    rivalsGroupStatsRowsUpdated: rivalsExtra,
  }
}
