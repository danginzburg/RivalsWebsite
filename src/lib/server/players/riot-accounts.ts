import { supabaseAdmin } from '$lib/supabase/admin'
import { RiotLookupError, fetchAccount } from '$lib/server/riot/henrik'

/**
 * Service layer for `riot_accounts` — every Riot ID and PUUID we know about,
 * whether a profile owns it (primary, alts, name aliases) or nobody does yet
 * (the identity review queue, see riot-identities.ts). Kept in one place so the
 * signup form, the account page, the self-serve alt endpoint and the admin
 * approval endpoint all apply the same rules.
 */

export type PublicRiotAccount = {
  id: string
  riot_name: string
  riot_tag: string
  riot_puuid: string | null
  is_primary: boolean
  status: 'pending' | 'approved' | 'rejected'
  label: string | null
  verified_at: string | null
  created_at: string | null
}

// `riot_puuid` and a '' tag keep the shape the UI has always been given.
const ACCOUNT_COLUMNS =
  'id, riot_name, riot_tag, riot_puuid:puuid, is_primary, status, label, verified_at, created_at'

function toPublic(row: Record<string, unknown>): PublicRiotAccount {
  return { ...(row as PublicRiotAccount), riot_tag: (row.riot_tag as string | null) ?? '' }
}

/** A tag of '' or whitespace is stored as null: the account has no known tag. */
function storedTag(tag: string | null | undefined): string | null {
  return String(tag ?? '').trim() || null
}

/** Best-effort PUUID lookup: never throws, returns null on any failure. */
async function tryFetchPuuid(name: string, tag: string): Promise<string | null> {
  try {
    const account = await fetchAccount(name, tag)
    return account.puuid ?? null
  } catch {
    return null
  }
}

/** True when this Riot ID already belongs to a different profile's account. */
export async function riotIdOwnedByOther(
  name: string,
  tag: string,
  profileId: string
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('riot_accounts')
    .select('profile_id')
    .ilike('riot_name', name)
    .ilike('riot_tag', tag)
    .not('profile_id', 'is', null)
    .neq('profile_id', profileId)
    .limit(1)
  return Boolean(data?.length)
}

/** All of a profile's Riot accounts, primary first. */
export async function listRiotAccounts(profileId: string): Promise<PublicRiotAccount[]> {
  const { data, error } = await supabaseAdmin
    .from('riot_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('profile_id', profileId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) throw new Error('Failed to load Riot accounts')
  return (data ?? []).map(toPublic)
}

export type ProfileRiotAccount = PublicRiotAccount & {
  /** Accounts an admin linked from the identity queue cannot be edited here. */
  source: 'account' | 'identity'
}

/**
 * The Riot accounts a profile page lists: only full name#tag accounts backed
 * by a PUUID — a bare name alias or a signup that never verified is not a real
 * link. Display only; the self-serve API works on `listRiotAccounts`.
 */
export async function listProfileRiotAccounts(profileId: string): Promise<ProfileRiotAccount[]> {
  const { data, error } = await supabaseAdmin
    .from('riot_accounts')
    .select(`${ACCOUNT_COLUMNS}, linked_at`)
    .eq('profile_id', profileId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })
  if (error) throw new Error('Failed to load Riot accounts')

  const linked: ProfileRiotAccount[] = (data ?? [])
    .map((row) => ({
      ...toPublic(row),
      source: (row.linked_at ? 'identity' : 'account') as ProfileRiotAccount['source'],
    }))
    .filter((a) => a.riot_puuid && a.riot_name.trim() && a.riot_tag.trim())

  // If the declared primary was filtered out, the earliest approved link stands
  // in for it so the profile still has a main Riot ID.
  if (!linked.some((a) => a.is_primary)) {
    const stand = linked.find((a) => a.status === 'approved')
    if (stand) stand.is_primary = true
  }
  return linked
}

/**
 * The PUUID to look each profile's rank up by: the primary account's, then any
 * other approved account's. Profiles with none linked are left out of the map.
 */
export async function linkedPuuidsFor(profileIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(profileIds.filter(Boolean))]
  const puuids = new Map<string, string>()
  if (ids.length === 0) return puuids

  for (const [profileId, link] of await loadRiotLinks(ids)) puuids.set(profileId, link.puuid)
  return puuids
}

/**
 * Create or update a profile's primary Riot account. The primary is the
 * player's own declared identity, so it is auto-approved. PUUID capture is
 * best-effort — a Riot API hiccup must not block a signup.
 */
export async function upsertPrimaryRiotAccount(opts: {
  profileId: string
  riotName: string
  riotTag: string
}): Promise<{ puuid: string | null }> {
  const puuid = await tryFetchPuuid(opts.riotName, opts.riotTag)

  const base = {
    profile_id: opts.profileId,
    riot_name: opts.riotName,
    riot_tag: storedTag(opts.riotTag),
    is_primary: true,
    status: 'approved' as const,
  }

  // The PUUID may already sit on an account nobody owns (seen in a match before
  // this player signed up) or on one of their own alts. Either way that row
  // becomes the primary, rather than writing the PUUID a second time.
  if (puuid) {
    const linked = await claimPuuidAsPrimary(opts.profileId, puuid, base)
    if (linked) return { puuid }
  }

  const { data: existing } = await supabaseAdmin
    .from('riot_accounts')
    .select('id')
    .eq('profile_id', opts.profileId)
    .eq('is_primary', true)
    .maybeSingle()

  // A PUUID owned by another player is left off; a later import can backfill.
  const row =
    puuid && !(await puuidOwnedByOther(puuid, opts.profileId))
      ? { ...base, puuid, verified_at: new Date().toISOString() }
      : base

  const { error } = existing?.id
    ? await supabaseAdmin.from('riot_accounts').update(row).eq('id', existing.id)
    : await supabaseAdmin.from('riot_accounts').insert(row)
  if (error) throw new Error('Failed to save primary Riot account')

  return { puuid: 'puuid' in row ? row.puuid : null }
}

/**
 * Make the account carrying `puuid` this profile's primary, if it is unowned
 * or already theirs. Returns false when no such account exists (or another
 * player owns it), leaving the caller to write the primary itself.
 */
async function claimPuuidAsPrimary(
  profileId: string,
  puuid: string,
  row: Record<string, unknown>
): Promise<boolean> {
  const { data: holder } = await supabaseAdmin
    .from('riot_accounts')
    .select('id, profile_id')
    .eq('puuid', puuid)
    .maybeSingle()
  if (!holder || (holder.profile_id && holder.profile_id !== profileId)) return false

  const { data: primary } = await supabaseAdmin
    .from('riot_accounts')
    .select('id')
    .eq('profile_id', profileId)
    .eq('is_primary', true)
    .maybeSingle()

  if (primary?.id && primary.id !== holder.id) {
    // The old primary stays as an alt unless it was only a name placeholder.
    await supabaseAdmin.from('riot_accounts').update({ is_primary: false }).eq('id', primary.id)
    await supabaseAdmin
      .from('riot_accounts')
      .delete()
      .eq('id', primary.id)
      .is('puuid', null)
      .ilike('riot_name', String(row.riot_name))
  }

  const now = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('riot_accounts')
    .update({ ...row, verified_at: now, linked_at: holder.profile_id ? undefined : now })
    .eq('id', holder.id)
  if (error) throw new RiotAccountError(409, 'That Riot account is already linked to an account.')
  return true
}

export type RiotLink = { riotId: string; riotName: string; riotTag: string | null; puuid: string }

function formatRiotId(name: string | null | undefined, tag: string | null | undefined): string {
  const n = String(name ?? '').trim()
  const t = String(tag ?? '').trim()
  return t ? `${n}#${t}` : n
}

/**
 * The PUUID-backed Riot ID each profile is linked to, keyed by profile id. The
 * primary account wins when it has a PUUID, then the earliest approved one.
 */
export async function loadRiotLinks(profileIds?: string[]): Promise<Map<string, RiotLink>> {
  let query = supabaseAdmin
    .from('riot_accounts')
    .select('profile_id, riot_name, riot_tag, puuid, is_primary, created_at')
    .not('profile_id', 'is', null)
    .eq('status', 'approved')
    .not('puuid', 'is', null)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })
  if (profileIds) query = query.in('profile_id', profileIds)

  const { data, error } = await query
  if (error) throw new Error('Failed to load Riot links')

  const links = new Map<string, RiotLink>()
  for (const a of data ?? []) {
    if (links.has(a.profile_id)) continue
    links.set(a.profile_id, {
      riotId: formatRiotId(a.riot_name, a.riot_tag),
      riotName: a.riot_name,
      riotTag: String(a.riot_tag ?? '').trim() || null,
      puuid: a.puuid,
    })
  }
  return links
}

/** True once the profile has an approved account with a PUUID. */
export async function hasLinkedRiotAccount(profileId: string): Promise<boolean> {
  return (await loadRiotLinks([profileId])).has(profileId)
}

/**
 * Link a profile's primary Riot account from a full Riot ID, strictly: the
 * account must resolve against Riot and its PUUID must not belong to anyone
 * else. Unlike `upsertPrimaryRiotAccount`, a failed lookup is an error here,
 * because the PUUID is the whole point of the login prompt.
 */
export async function linkPrimaryRiotAccount(opts: {
  profileId: string
  riotName: string
  riotTag: string
}): Promise<{ riotName: string; riotTag: string; puuid: string }> {
  let account
  try {
    account = await fetchAccount(opts.riotName, opts.riotTag)
  } catch (err) {
    if (err instanceof RiotLookupError) throw new RiotAccountError(err.status, err.message)
    throw err
  }
  if (!account.puuid) {
    throw new RiotAccountError(502, 'Riot did not return an account ID. Try again shortly.')
  }

  // Riot's own casing, so the stored name matches what imports report.
  const riotName = account.name || opts.riotName
  const riotTag = (account.tag || opts.riotTag).toUpperCase()

  if (await riotIdOwnedByOther(riotName, riotTag, opts.profileId)) {
    throw new RiotAccountError(409, 'That Riot ID is already linked to another account.')
  }
  if (await puuidOwnedByOther(account.puuid, opts.profileId)) {
    throw new RiotAccountError(409, 'That Riot account is already linked to another player.')
  }

  const row = {
    profile_id: opts.profileId,
    riot_name: riotName,
    riot_tag: riotTag,
    is_primary: true,
    status: 'approved' as const,
  }

  if (!(await claimPuuidAsPrimary(opts.profileId, account.puuid, row))) {
    const { data: existing } = await supabaseAdmin
      .from('riot_accounts')
      .select('id')
      .eq('profile_id', opts.profileId)
      .eq('is_primary', true)
      .maybeSingle()

    const full = { ...row, puuid: account.puuid, verified_at: new Date().toISOString() }
    const { error } = existing?.id
      ? await supabaseAdmin.from('riot_accounts').update(full).eq('id', existing.id)
      : await supabaseAdmin.from('riot_accounts').insert(full)
    if (error) throw new RiotAccountError(409, 'That Riot account is already linked to an account.')
  }

  return { riotName, riotTag, puuid: account.puuid }
}

async function puuidOwnedByOther(puuid: string, profileId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('riot_accounts')
    .select('profile_id')
    .eq('puuid', puuid)
    .not('profile_id', 'is', null)
    .neq('profile_id', profileId)
    .maybeSingle()
  return Boolean(data)
}

export class RiotAccountError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * Add an alternate Riot account for a profile. The account must exist (verified
 * against Riot) and not belong to anyone else. It is created pending, so an
 * admin approves it before its stats pool into the profile.
 */
export async function addAltRiotAccount(opts: {
  profileId: string
  riotName: string
  riotTag: string
  label?: string | null
}): Promise<PublicRiotAccount> {
  let puuid: string | null
  try {
    const account = await fetchAccount(opts.riotName, opts.riotTag)
    puuid = account.puuid ?? null
  } catch (err) {
    if (err instanceof RiotLookupError) throw new RiotAccountError(err.status, err.message)
    throw err
  }

  if (await riotIdOwnedByOther(opts.riotName, opts.riotTag, opts.profileId)) {
    throw new RiotAccountError(409, 'That Riot ID is already linked to another account.')
  }
  if (puuid && (await puuidOwnedByOther(puuid, opts.profileId))) {
    throw new RiotAccountError(409, 'That Riot account is already linked to another player.')
  }

  const row = {
    profile_id: opts.profileId,
    riot_name: opts.riotName,
    riot_tag: storedTag(opts.riotTag),
    is_primary: false,
    status: 'pending' as const,
    label: opts.label ?? null,
    verified_at: puuid ? new Date().toISOString() : null,
  }

  // A PUUID seen in a match but owned by nobody is claimed in place (still
  // pending), so the account keeps its sighting history.
  if (puuid) {
    const { data: unowned } = await supabaseAdmin
      .from('riot_accounts')
      .select('id')
      .eq('puuid', puuid)
      .is('profile_id', null)
      .maybeSingle()
    if (unowned?.id) {
      const { data, error } = await supabaseAdmin
        .from('riot_accounts')
        .update(row)
        .eq('id', unowned.id)
        .select(ACCOUNT_COLUMNS)
        .single()
      if (error) throw new RiotAccountError(409, 'That Riot ID is already linked to an account.')
      return toPublic(data)
    }
  }

  const { data, error } = await supabaseAdmin
    .from('riot_accounts')
    .insert({ ...row, puuid })
    .select(ACCOUNT_COLUMNS)
    .single()

  if (error) {
    // Unique index race, most likely.
    throw new RiotAccountError(409, 'That Riot ID is already linked to an account.')
  }
  return toPublic(data)
}

/**
 * Update the primary account's name when a Riot ID is edited without a tag
 * (the player-page / admin rename form). Preserves the existing tag and PUUID;
 * creates a tagless primary if the profile has none yet.
 */
export async function syncPrimaryRiotName(profileId: string, riotName: string): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from('riot_accounts')
    .select('id')
    .eq('profile_id', profileId)
    .eq('is_primary', true)
    .maybeSingle()

  const { error } = existing?.id
    ? await supabaseAdmin
        .from('riot_accounts')
        .update({ riot_name: riotName })
        .eq('id', existing.id)
    : await supabaseAdmin.from('riot_accounts').insert({
        profile_id: profileId,
        riot_name: riotName,
        is_primary: true,
        status: 'approved',
      })
  if (error) throw new Error('Failed to save primary Riot account name')
}

/** Label on the tagless account that holds a player's stats name alias. */
export const STATS_ALIAS_LABEL = 'Stats name alias'

/** True when an owned account other than this profile's already uses the name. */
export async function riotNameOwnedByOther(name: string, profileId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('riot_accounts')
    .select('profile_id')
    .ilike('riot_name', name)
    .not('profile_id', 'is', null)
    .neq('profile_id', profileId)
    .limit(1)
  return Boolean(data?.length)
}

/**
 * Give a profile a bare Riot name to match stats by (no tag, no PUUID). The
 * name becomes the primary account when the profile has none; otherwise it is
 * an approved alias, so it never overwrites a verified primary.
 */
export async function claimRiotName(
  profileId: string,
  name: string,
  label: string | null = null
): Promise<void> {
  const { data: primary } = await supabaseAdmin
    .from('riot_accounts')
    .select('id')
    .eq('profile_id', profileId)
    .eq('is_primary', true)
    .maybeSingle()
  if (!primary) return syncPrimaryRiotName(profileId, name)

  const { data: existing } = await supabaseAdmin
    .from('riot_accounts')
    .select('id')
    .eq('profile_id', profileId)
    .ilike('riot_name', name)
    .limit(1)
  if (existing?.length) return

  const { error } = await supabaseAdmin
    .from('riot_accounts')
    .insert({ profile_id: profileId, riot_name: name, status: 'approved', label })
  if (error) throw new Error('Failed to save Riot name')
}

/** Replace (or, with null, remove) the profile's stats name alias. */
export async function setStatsNameAlias(profileId: string, name: string | null): Promise<void> {
  const { error } = await supabaseAdmin
    .from('riot_accounts')
    .delete()
    .eq('profile_id', profileId)
    .eq('label', STATS_ALIAS_LABEL)
    .is('puuid', null)
    .eq('is_primary', false)
  if (error) throw new Error('Failed to clear stats name alias')
  if (name) await claimRiotName(profileId, name, STATS_ALIAS_LABEL)
}

/** The profile's stats name alias, if it has one. */
export async function statsNameAlias(profileId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('riot_accounts')
    .select('riot_name')
    .eq('profile_id', profileId)
    .eq('label', STATS_ALIAS_LABEL)
    .limit(1)
  return (data?.[0]?.riot_name as string | undefined) ?? null
}

/** Remove one of a profile's own non-primary accounts. */
export async function removeAltRiotAccount(accountId: string, profileId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('riot_accounts')
    .delete()
    .eq('id', accountId)
    .eq('profile_id', profileId)
    .eq('is_primary', false)

  if (error) throw new Error('Failed to remove Riot account')
}
