import { supabaseAdmin } from '$lib/supabase/admin'
import { RiotLookupError, fetchAccount } from '$lib/server/riot/henrik'

/**
 * Service layer for `profile_riot_accounts` — the Riot accounts (primary + alt)
 * that pool into one profile. Kept in one place so the signup form, the account
 * page, the self-serve alt endpoint and the admin approval endpoint all apply
 * the same rules.
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

const ACCOUNT_COLUMNS =
  'id, riot_name, riot_tag, riot_puuid, is_primary, status, label, verified_at, created_at'

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
    .from('profile_riot_accounts')
    .select('profile_id')
    .ilike('riot_name', name)
    .ilike('riot_tag', tag)
    .neq('profile_id', profileId)
    .maybeSingle()
  return Boolean(data)
}

/** All of a profile's Riot accounts, primary first. */
export async function listRiotAccounts(profileId: string): Promise<PublicRiotAccount[]> {
  const { data, error } = await supabaseAdmin
    .from('profile_riot_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('profile_id', profileId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) throw new Error('Failed to load Riot accounts')
  return (data ?? []) as PublicRiotAccount[]
}

export type ProfileRiotAccount = PublicRiotAccount & {
  /**
   * `identity` rows exist only as an admin link in `riot_identities` (no
   * account row), so they are shown but cannot be edited or removed here.
   */
  source: 'account' | 'identity'
}

/**
 * The Riot accounts a profile page lists: full, PUUID-linked accounts from the
 * player's account rows plus any PUUID an admin linked from the identities tab
 * that never got an account row of its own. Display only — the self-serve API
 * keeps working on all account rows via `listRiotAccounts`.
 */
export async function listProfileRiotAccounts(profileId: string): Promise<ProfileRiotAccount[]> {
  const [accounts, { data: identities }] = await Promise.all([
    listRiotAccounts(profileId),
    supabaseAdmin
      .from('riot_identities')
      .select('puuid, latest_name, latest_tag, linked_at, first_seen_at')
      .eq('profile_id', profileId)
      .order('linked_at', { ascending: true }),
  ])

  const knownPuuids = new Set(accounts.map((a) => a.riot_puuid).filter(Boolean))
  const extra: ProfileRiotAccount[] = (identities ?? [])
    .filter((i) => i.puuid && !knownPuuids.has(i.puuid))
    .map((i) => ({
      id: `identity:${i.puuid}`,
      riot_name: i.latest_name?.trim() || 'Unknown',
      riot_tag: i.latest_tag?.trim() || '',
      riot_puuid: i.puuid,
      is_primary: false,
      status: 'approved',
      label: 'Linked by admin',
      verified_at: i.linked_at ?? null,
      created_at: i.first_seen_at ?? null,
      source: 'identity',
    }))

  // Only full name#tag accounts backed by a PUUID — name-only legacy rows (a
  // bare `riot_id_base` copy, a signup that never verified) are not real links.
  const linked = [...accounts.map((a) => ({ ...a, source: 'account' as const })), ...extra].filter(
    (a) => a.riot_puuid && a.riot_name.trim() && a.riot_tag.trim()
  )

  // If the declared primary was filtered out, the earliest approved link stands
  // in for it so the profile still has a main Riot ID.
  if (!linked.some((a) => a.is_primary)) {
    const stand = linked.find((a) => a.status === 'approved')
    if (stand) stand.is_primary = true
  }
  return linked
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
    riot_tag: opts.riotTag,
    is_primary: true,
    status: 'approved' as const,
  }
  // Only write the PUUID when we have one and it is not already held by another
  // account (the unique index would reject it). Leaving it null lets a later
  // import backfill it.
  const withPuuid =
    puuid && !(await puuidOwnedByOther(puuid, opts.profileId))
      ? { ...base, riot_puuid: puuid, verified_at: new Date().toISOString() }
      : base

  const { data: existing } = await supabaseAdmin
    .from('profile_riot_accounts')
    .select('id')
    .eq('profile_id', opts.profileId)
    .eq('is_primary', true)
    .maybeSingle()

  if (existing?.id) {
    const { error } = await supabaseAdmin
      .from('profile_riot_accounts')
      .update(withPuuid)
      .eq('id', existing.id)
    if (error) throw new Error('Failed to update primary Riot account')
  } else {
    const { error } = await supabaseAdmin.from('profile_riot_accounts').insert(withPuuid)
    if (error) throw new Error('Failed to create primary Riot account')
  }

  return { puuid: 'riot_puuid' in withPuuid ? (withPuuid.riot_puuid ?? null) : null }
}

export type RiotLink = { riotId: string; puuid: string }

function formatRiotId(name: string | null | undefined, tag: string | null | undefined): string {
  const n = String(name ?? '').trim()
  const t = String(tag ?? '').trim()
  return t ? `${n}#${t}` : n
}

/**
 * The PUUID-backed Riot ID each profile is linked to, keyed by profile id.
 *
 * A PUUID reaches a profile three ways: match imports backfill it onto a
 * name-matched account, the admin identities tab links it (often onto a
 * secondary account, or only in `riot_identities`), and the login prompt sets
 * it on the primary. Any of them counts. A primary account with a PUUID wins,
 * then any approved account, then a bare `riot_identities` link.
 */
export async function loadRiotLinks(profileIds?: string[]): Promise<Map<string, RiotLink>> {
  let accountsQuery = supabaseAdmin
    .from('profile_riot_accounts')
    .select('profile_id, riot_name, riot_tag, riot_puuid, is_primary')
    .eq('status', 'approved')
    .not('riot_puuid', 'is', null)
  let identitiesQuery = supabaseAdmin
    .from('riot_identities')
    .select('profile_id, puuid, latest_name, latest_tag')
    .not('profile_id', 'is', null)
  if (profileIds) {
    accountsQuery = accountsQuery.in('profile_id', profileIds)
    identitiesQuery = identitiesQuery.in('profile_id', profileIds)
  }

  const [{ data: accounts, error: accountsError }, { data: identities, error: identitiesError }] =
    await Promise.all([accountsQuery, identitiesQuery])
  if (accountsError || identitiesError) throw new Error('Failed to load Riot links')

  const links = new Map<string, RiotLink>()
  // Primaries first so they claim the slot before secondaries.
  const sorted = [...(accounts ?? [])].sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
  for (const a of sorted) {
    if (links.has(a.profile_id)) continue
    links.set(a.profile_id, {
      riotId: formatRiotId(a.riot_name, a.riot_tag),
      puuid: a.riot_puuid as string,
    })
  }
  for (const i of identities ?? []) {
    const profileId = i.profile_id as string
    if (links.has(profileId)) continue
    links.set(profileId, { riotId: formatRiotId(i.latest_name, i.latest_tag), puuid: i.puuid })
  }
  return links
}

/** True once the profile has a PUUID by any of the routes `loadRiotLinks` covers. */
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
    riot_puuid: account.puuid,
    is_primary: true,
    status: 'approved' as const,
    verified_at: new Date().toISOString(),
  }

  const { data: existing } = await supabaseAdmin
    .from('profile_riot_accounts')
    .select('id')
    .eq('profile_id', opts.profileId)
    .eq('is_primary', true)
    .maybeSingle()

  // An import or the identities tab may already have put this PUUID on one of
  // the player's secondary accounts. Promote that row rather than writing the
  // PUUID a second time, which the unique index would reject.
  const { data: samePuuid } = await supabaseAdmin
    .from('profile_riot_accounts')
    .select('id')
    .eq('profile_id', opts.profileId)
    .eq('riot_puuid', account.puuid)
    .maybeSingle()

  let error
  if (samePuuid?.id && samePuuid.id !== existing?.id) {
    if (existing?.id) {
      await supabaseAdmin
        .from('profile_riot_accounts')
        .update({ is_primary: false })
        .eq('id', existing.id)
    }
    ;({ error } = await supabaseAdmin
      .from('profile_riot_accounts')
      .update(row)
      .eq('id', samePuuid.id))
  } else if (existing?.id) {
    ;({ error } = await supabaseAdmin
      .from('profile_riot_accounts')
      .update(row)
      .eq('id', existing.id))
  } else {
    ;({ error } = await supabaseAdmin.from('profile_riot_accounts').insert(row))
  }
  if (error) throw new RiotAccountError(409, 'That Riot account is already linked to an account.')

  return { riotName, riotTag, puuid: account.puuid }
}

async function puuidOwnedByOther(puuid: string, profileId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('profile_riot_accounts')
    .select('profile_id')
    .eq('riot_puuid', puuid)
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

  const { data, error } = await supabaseAdmin
    .from('profile_riot_accounts')
    .insert({
      profile_id: opts.profileId,
      riot_name: opts.riotName,
      riot_tag: opts.riotTag,
      riot_puuid: puuid,
      is_primary: false,
      status: 'pending',
      label: opts.label ?? null,
      verified_at: puuid ? new Date().toISOString() : null,
    })
    .select(ACCOUNT_COLUMNS)
    .single()

  if (error) {
    // Unique index race, most likely.
    throw new RiotAccountError(409, 'That Riot ID is already linked to an account.')
  }
  return data as PublicRiotAccount
}

/**
 * Update the primary account's name when a Riot ID is edited without a tag
 * (the player-page / admin rename form). Preserves the existing tag and PUUID;
 * creates a primary row with an empty tag if the profile has none yet.
 */
export async function syncPrimaryRiotName(profileId: string, riotName: string): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from('profile_riot_accounts')
    .select('id')
    .eq('profile_id', profileId)
    .eq('is_primary', true)
    .maybeSingle()

  if (existing?.id) {
    const { error } = await supabaseAdmin
      .from('profile_riot_accounts')
      .update({ riot_name: riotName })
      .eq('id', existing.id)
    if (error) throw new Error('Failed to update primary Riot account name')
  } else {
    const { error } = await supabaseAdmin.from('profile_riot_accounts').insert({
      profile_id: profileId,
      riot_name: riotName,
      riot_tag: '',
      is_primary: true,
      status: 'approved',
    })
    if (error) throw new Error('Failed to create primary Riot account')
  }
}

/** Remove one of a profile's own non-primary accounts. */
export async function removeAltRiotAccount(accountId: string, profileId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('profile_riot_accounts')
    .delete()
    .eq('id', accountId)
    .eq('profile_id', profileId)
    .eq('is_primary', false)

  if (error) throw new Error('Failed to remove Riot account')
}
