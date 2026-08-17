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
