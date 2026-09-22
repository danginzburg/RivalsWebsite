import { supabaseAdmin } from '$lib/supabase/admin'
import { claimRelinkAfterProfileUpdate } from '$lib/server/players/claim-relink'

/**
 * Service layer for `riot_identities` — the PUUID registry that tracks a
 * player's game identity behind the scenes, independent of whatever name they
 * are currently using.
 *
 * Every PUUID seen in a match import is recorded here automatically (name and
 * all), whether or not it maps to a profile yet. An admin links an unlinked
 * PUUID to a profile once from the review queue; after that the identity — and
 * all of its past and future stats — follows the PUUID through any rename.
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
 * Record every PUUID seen in an import, refreshing the name we know it by.
 *
 * New PUUIDs are inserted (unlinked, queued for admin review); known ones have
 * their `latest_name`/`latest_tag`/`last_seen_at` updated so the registry
 * always reflects the current in-game name. `profile_id` is never touched here
 * — linking is a deliberate admin action, not a side effect of an import.
 *
 * Best-effort by design: the match is already written by the time this runs, so
 * a failure here must not fail the import.
 */
export async function upsertRiotIdentities(observations: RiotObservation[]): Promise<number> {
  const rows = dedupeObservations(observations)
  if (rows.length === 0) return 0

  const now = new Date().toISOString()
  // Only insert/update columns we mean to refresh. Because `first_seen_at`,
  // `created_at` and `profile_id` are omitted, the conflict update leaves them
  // untouched while a fresh insert falls back to their column defaults.
  const payload = rows.map((row) => ({
    puuid: row.puuid,
    latest_name: row.name,
    latest_tag: row.tag,
    last_seen_at: now,
  }))

  const { error, count } = await supabaseAdmin
    .from('riot_identities')
    .upsert(payload, { onConflict: 'puuid', count: 'exact' })

  if (error) throw new Error(`Failed to upsert riot identities: ${error.message}`)
  return count ?? rows.length
}

/**
 * The admin review queue: PUUIDs we have seen in matches that belong to no
 * profile yet, ranked by how much they have played (the map count is computed
 * live from the stat rows, so it is right regardless of re-imports).
 */
export async function listUnlinkedIdentities(limit = 200): Promise<UnlinkedIdentity[]> {
  const { data: identities, error } = await supabaseAdmin
    .from('riot_identities')
    .select('puuid, latest_name, latest_tag, first_seen_at, last_seen_at')
    .is('profile_id', null)
    .order('last_seen_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error('Failed to load unlinked identities')
  const rows = identities ?? []
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

/**
 * Attach the PUUID's Riot account to the profile, unless it already exists.
 * Made primary only when the profile has no primary account yet, so linking a
 * secondary identity never displaces the player's declared main.
 */
async function ensureRiotAccountForPuuid(
  profileId: string,
  puuid: string,
  name: string,
  tag: string
): Promise<void> {
  const now = new Date().toISOString()

  const { data: byPuuid } = await supabaseAdmin
    .from('profile_riot_accounts')
    .select('id, profile_id')
    .eq('riot_puuid', puuid)
    .maybeSingle()

  if (byPuuid) {
    if (byPuuid.profile_id !== profileId) {
      throw new RiotIdentityError(409, 'That PUUID is already linked to another player.')
    }
    await supabaseAdmin
      .from('profile_riot_accounts')
      .update({ status: 'approved', verified_at: now })
      .eq('id', byPuuid.id)
    return
  }

  const { data: primary } = await supabaseAdmin
    .from('profile_riot_accounts')
    .select('id')
    .eq('profile_id', profileId)
    .eq('is_primary', true)
    .maybeSingle()

  const { error: insertError } = await supabaseAdmin.from('profile_riot_accounts').insert({
    profile_id: profileId,
    riot_name: name,
    riot_tag: tag,
    riot_puuid: puuid,
    is_primary: !primary,
    status: 'approved',
    label: 'Linked from match identity',
    verified_at: now,
  })

  if (insertError) {
    // Most likely the name/tag unique index: this Riot ID is on another account.
    throw new RiotIdentityError(
      409,
      'That Riot ID is already linked to an account. Resolve that account first.'
    )
  }
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
    .from('riot_identities')
    .select('puuid, latest_name, latest_tag, profile_id')
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

  await ensureRiotAccountForPuuid(
    opts.profileId,
    puuid,
    identity.latest_name?.trim() || puuid,
    identity.latest_tag?.trim() || ''
  )

  const { error: updateError } = await supabaseAdmin
    .from('riot_identities')
    .update({
      profile_id: opts.profileId,
      linked_by: opts.adminProfileId,
      linked_at: new Date().toISOString(),
    })
    .eq('puuid', puuid)
    .is('profile_id', null)

  if (updateError) throw new RiotIdentityError(500, 'Failed to link identity.')

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
