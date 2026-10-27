import { supabaseAdmin } from '$lib/supabase/admin'
import { claimRelinkAfterProfileUpdate } from '$lib/server/players/claim-relink'
import { fetchAllRows } from '$lib/server/supabase/fetch-all'

/**
 * The PUUID side of `riot_accounts`: every PUUID seen in a match import gets an
 * account row automatically, name and all, whether or not a profile owns it.
 * Rows with no `profile_id` are the admin review queue; an admin links one to a
 * profile once, and after that the identity — and all of its past and future
 * stats — follows the PUUID through any rename.
 */

export type RiotObservation = {
  puuid: string | null | undefined
  name: string | null | undefined
  tag: string | null | undefined
}

export type UnlinkedIdentity = {
  puuid: string
  latest_name: string | null
  latest_tag: string | null
  last_seen_at: string | null
  first_seen_at: string | null
  maps_seen: number
}

export class RiotIdentityError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * Collapse a series' worth of player rows to one observation per PUUID. The
 * same PUUID appears on every map of a series, and re-imports repeat it, so the
 * registry only cares about the latest name we saw it under.
 */
export function dedupeObservations(observations: RiotObservation[]): Array<{
  puuid: string
  name: string | null
  tag: string | null
}> {
  const byPuuid = new Map<string, { puuid: string; name: string | null; tag: string | null }>()
  for (const obs of observations) {
    const puuid = String(obs.puuid ?? '').trim()
    if (!puuid) continue
    const name = String(obs.name ?? '').trim() || null
    const tag = String(obs.tag ?? '').trim() || null
    // Last write wins: later maps carry the same or a fresher name.
    byPuuid.set(puuid, { puuid, name, tag })
  }
  return Array.from(byPuuid.values())
}

/**
 * Record every PUUID seen in an import.
 *
 * New PUUIDs are inserted unowned (queued for admin review). Known ones have
 * `last_seen_at` refreshed and take the latest name, so every account shows
 * what the player is called now. `profile_id` is never touched here — linking
 * is a deliberate admin action, not a side effect of an import.
 *
 * Best-effort by design: the match is already written by the time this runs, so
 * a failure here must not fail the import.
 */
export async function upsertRiotIdentities(observations: RiotObservation[]): Promise<number> {
  const rows = dedupeObservations(observations)
  if (rows.length === 0) return 0

  const now = new Date().toISOString()
  const { data: known, error: knownError } = await supabaseAdmin
    .from('riot_accounts')
    .select('puuid, profile_id, riot_name, riot_tag')
    .in(
      'puuid',
      rows.map((r) => r.puuid)
    )
  if (knownError) throw new Error(`Failed to load riot accounts: ${knownError.message}`)

  const ownerByPuuid = new Map((known ?? []).map((k) => [k.puuid as string, k.profile_id]))
  const fresh = rows.filter((r) => !ownerByPuuid.has(r.puuid))
  const unowned = rows.filter((r) => ownerByPuuid.has(r.puuid) && !ownerByPuuid.get(r.puuid))
  const owned = rows.filter((r) => ownerByPuuid.get(r.puuid))

  const named = (r: (typeof rows)[number]) => ({
    puuid: r.puuid,
    riot_name: r.name ?? r.puuid,
    riot_tag: r.tag,
    last_seen_at: now,
  })

  if (fresh.length > 0) {
    // ignoreDuplicates covers a concurrent import inserting the same PUUID.
    const { error } = await supabaseAdmin.from('riot_accounts').upsert(
      fresh.map((r) => ({ ...named(r), first_seen_at: now })),
      { onConflict: 'puuid', ignoreDuplicates: true }
    )
    if (error) throw new Error(`Failed to insert riot accounts: ${error.message}`)
  }
  if (unowned.length > 0) {
    const { error } = await supabaseAdmin
      .from('riot_accounts')
      .upsert(unowned.map(named), { onConflict: 'puuid' })
    if (error) throw new Error(`Failed to refresh riot accounts: ${error.message}`)
  }
  // The PUUID is the account; the name is just what Riot calls it today. An
  // owned account follows a rename (or gains a missing tag) whenever a match
  // reports a full name#tag that differs from the one on file.
  const knownByPuuid = new Map((known ?? []).map((k) => [k.puuid as string, k]))
  for (const r of owned) {
    const account = knownByPuuid.get(r.puuid)
    if (!account || !r.name || !r.tag) continue
    const same =
      String(account.riot_name ?? '').toLowerCase() === r.name.toLowerCase() &&
      String(account.riot_tag ?? '').toLowerCase() === r.tag.toLowerCase()
    if (same) continue
    // Best-effort: the owned name/tag index rejects a name another player
    // still holds on file; that account is left as it was.
    await supabaseAdmin
      .from('riot_accounts')
      .update({ riot_name: r.name, riot_tag: r.tag })
      .eq('puuid', r.puuid)
  }

  if (owned.length > 0) {
    const { error } = await supabaseAdmin
      .from('riot_accounts')
      .update({ last_seen_at: now })
      .in(
        'puuid',
        owned.map((r) => r.puuid)
      )
    if (error) throw new Error(`Failed to refresh riot accounts: ${error.message}`)
  }
  return rows.length
}

/**
 * The admin review queue: PUUIDs we have seen in matches that belong to no
 * profile yet, ranked by how much they have played (the map count is computed
 * live from the stat rows, so it is right regardless of re-imports).
 */
export async function listUnlinkedIdentities(
  limit = 200,
  opts: { seasonId?: string | null } = {}
): Promise<UnlinkedIdentity[]> {
  let rows: Array<{
    puuid: string
    latest_name: string | null
    latest_tag: string | null
    first_seen_at: string | null
    last_seen_at: string | null
  }> = []

  if (opts.seasonId !== undefined) {
    // Season-scoped: only identities that played a match in that season.
    const seasonPuuids = await puuidsSeenInSeason(opts.seasonId)
    for (let i = 0; i < seasonPuuids.length; i += 100) {
      const { data, error } = await supabaseAdmin
        .from('riot_accounts')
        .select('puuid, latest_name:riot_name, latest_tag:riot_tag, first_seen_at, last_seen_at')
        .is('profile_id', null)
        .in('puuid', seasonPuuids.slice(i, i + 100))
      if (error) throw new Error('Failed to load unlinked identities')
      rows.push(...(data ?? []))
    }
  } else {
    const { data: identities, error } = await supabaseAdmin
      .from('riot_accounts')
      .select('puuid, latest_name:riot_name, latest_tag:riot_tag, first_seen_at, last_seen_at')
      .is('profile_id', null)
      .not('puuid', 'is', null)
      .order('last_seen_at', { ascending: false })
      .limit(limit)

    if (error) throw new Error('Failed to load unlinked identities')
    rows = identities ?? []
  }
  if (rows.length === 0) return []

  // Count each identity's map appearances in one grouped read rather than a
  // query per row. `puuid` is indexed, so this is cheap at league scale.
  const puuids = rows.map((r) => r.puuid)
  const { data: statRows } = await supabaseAdmin
    .from('player_match_map_stats')
    .select('puuid')
    .in('puuid', puuids)

  const mapsByPuuid = new Map<string, number>()
  for (const row of statRows ?? []) {
    const p = String((row as { puuid?: string | null }).puuid ?? '')
    if (p) mapsByPuuid.set(p, (mapsByPuuid.get(p) ?? 0) + 1)
  }

  return rows
    .map((row) => ({
      puuid: row.puuid,
      latest_name: row.latest_name,
      latest_tag: row.latest_tag,
      first_seen_at: row.first_seen_at,
      last_seen_at: row.last_seen_at,
      maps_seen: mapsByPuuid.get(row.puuid) ?? 0,
    }))
    .sort((a, b) => b.maps_seen - a.maps_seen)
}

export type UnclaimedIdentity = {
  puuid: string
  latest_name: string | null
  latest_tag: string | null
  display_name: string | null
  first_seen_at: string | null
  last_seen_at: string | null
}

/** Every identity no profile owns yet — players who have never logged in. */
export async function listUnclaimedIdentities(): Promise<UnclaimedIdentity[]> {
  return fetchAllRows<UnclaimedIdentity>(() =>
    supabaseAdmin
      .from('riot_accounts')
      .select(
        'puuid, latest_name:riot_name, latest_tag:riot_tag, display_name, first_seen_at, last_seen_at'
      )
      .is('profile_id', null)
      .not('puuid', 'is', null)
      .order('last_seen_at', { ascending: false, nullsFirst: false })
      .order('puuid')
  )
}

/** Set (or clear, with null) the admin-chosen name of an unclaimed identity. */
export async function setIdentityDisplayName(
  puuid: string,
  displayName: string | null
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('riot_accounts')
    .update({ display_name: displayName })
    .eq('puuid', puuid)
    .is('profile_id', null)
    .select('puuid')
  if (error) throw new RiotIdentityError(500, 'Failed to update display name.')
  if (!data?.length) throw new RiotIdentityError(404, 'No such identity.')
}

/**
 * Admin-set names of unclaimed identities, keyed by lowercased `name#tag` and
 * bare name, so stat rows (Riot imports carry the tag, CSV rows do not) can be
 * shown under them.
 */
export async function loadIdentityDisplayNames(): Promise<Map<string, string>> {
  const identities = (await listUnclaimedIdentities()).filter((i) => i.display_name)
  const names = new Map<string, string>()
  for (const i of identities) {
    const base = i.latest_name?.trim().toLowerCase()
    if (!base) continue
    const tag = i.latest_tag?.trim().toLowerCase()
    if (tag) names.set(`${base}#${tag}`, i.display_name!)
    if (!names.has(base)) names.set(base, i.display_name!)
  }
  return names
}

/** The admin-set name waiting on this PUUID, if any. */
export async function identityDisplayName(puuid: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('riot_accounts')
    .select('display_name')
    .eq('puuid', puuid)
    .maybeSingle()
  return data?.display_name?.trim() || null
}

/**
 * Carry an identity's admin-set name over to the profile that now owns it,
 * unless the player already chose a name of their own.
 */
async function adoptIdentityDisplayName(profileId: string, puuid: string): Promise<void> {
  const name = await identityDisplayName(puuid)
  if (!name) return
  await supabaseAdmin
    .from('profiles')
    .update({ display_name: name, display_name_is_custom: true })
    .eq('id', profileId)
    .or('display_name_is_custom.is.null,display_name_is_custom.eq.false')
}

/** Every PUUID that appears in the stats of a match filed under the season. */
async function puuidsSeenInSeason(seasonId: string | null): Promise<string[]> {
  if (!seasonId) return []
  const { data: matches, error: matchesError } = await supabaseAdmin
    .from('matches')
    .select('id')
    .eq('season_id', seasonId)
  if (matchesError) throw new Error('Failed to load season matches')
  const matchIds = (matches ?? []).map((m) => m.id as string)

  const puuids = new Set<string>()
  for (let i = 0; i < matchIds.length; i += 100) {
    const { data, error } = await supabaseAdmin
      .from('player_match_map_stats')
      .select('puuid')
      .in('match_id', matchIds.slice(i, i + 100))
      .not('puuid', 'is', null)
    if (error) throw new Error('Failed to load season player stats')
    for (const row of data ?? []) if (row.puuid) puuids.add(row.puuid as string)
  }
  return Array.from(puuids)
}

export type LinkIdentityResult = {
  puuid: string
  profileId: string
  relink: Awaited<ReturnType<typeof claimRelinkAfterProfileUpdate>> | null
}

/**
 * Link an unlinked PUUID to a profile and pool all of its stats in.
 *
 * The heavy lifting is the existing claim relink: once the PUUID is an approved
 * Riot account on the profile, `claimRelinkAfterProfileUpdate` sweeps up every
 * stat row that carries this PUUID (or one of the profile's names), rebuilds
 * the affected match aggregates, and reconciles rosters — exactly as approving
 * a self-added alt does.
 */
export async function linkRiotIdentity(opts: {
  puuid: string
  profileId: string
  adminProfileId: string
}): Promise<LinkIdentityResult> {
  const puuid = opts.puuid.trim()
  if (!puuid) throw new RiotIdentityError(400, 'A PUUID is required.')

  const { data: identity, error: identityError } = await supabaseAdmin
    .from('riot_accounts')
    .select('id, profile_id')
    .eq('puuid', puuid)
    .maybeSingle()

  if (identityError) throw new RiotIdentityError(500, 'Failed to load identity.')
  if (!identity) throw new RiotIdentityError(404, 'No such identity.')
  if (identity.profile_id) {
    throw new RiotIdentityError(409, 'That identity is already linked to a player.')
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('id', opts.profileId)
    .maybeSingle()

  if (profileError) throw new RiotIdentityError(500, 'Failed to load profile.')
  if (!profile) throw new RiotIdentityError(404, 'No such player.')

  // Made primary only when the profile has none yet, so linking a secondary
  // identity never displaces the player's declared main.
  const { data: primary } = await supabaseAdmin
    .from('riot_accounts')
    .select('id')
    .eq('profile_id', opts.profileId)
    .eq('is_primary', true)
    .maybeSingle()

  const now = new Date().toISOString()
  const { data: linked, error: updateError } = await supabaseAdmin
    .from('riot_accounts')
    .update({
      profile_id: opts.profileId,
      is_primary: !primary,
      status: 'approved',
      label: 'Linked from match identity',
      verified_at: now,
      linked_by: opts.adminProfileId,
      linked_at: now,
    })
    .eq('id', identity.id)
    .is('profile_id', null)
    .select('id')

  if (updateError) {
    // Most likely the owned name/tag unique index: this Riot ID is on another account.
    throw new RiotIdentityError(
      409,
      'That Riot ID is already linked to an account. Resolve that account first.'
    )
  }
  if (!linked?.length) {
    throw new RiotIdentityError(409, 'That identity is already linked to a player.')
  }

  try {
    await adoptIdentityDisplayName(opts.profileId, puuid)
  } catch (err) {
    console.warn('adoptIdentityDisplayName failed after identity link:', err)
  }

  // Pool the identity's history into the profile: map stats (by PUUID), series
  // aggregates, leaderboard rows and rosters. Best-effort — the link itself is
  // already committed and can be re-run to heal a partial relink.
  let relink: LinkIdentityResult['relink'] = null
  try {
    relink = await claimRelinkAfterProfileUpdate(opts.profileId)
  } catch (err) {
    console.warn('claimRelinkAfterProfileUpdate failed after identity link:', err)
  }

  return { puuid, profileId: opts.profileId, relink }
}
