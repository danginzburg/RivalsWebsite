import { supabaseAdmin } from '$lib/supabase/admin'
import { fetchAllRows } from '$lib/server/supabase/fetch-all'

/**
 * Name → profile and PUUID → profile resolution, in one place.
 *
 * Every importer, roster check and accolade sync used to build its own maps
 * from `riot_accounts` and `profiles`, each with slightly different rules
 * (some counted pending accounts, some let a clashing name silently pick a
 * profile). They all go through here now, so a player matches the same way
 * everywhere.
 *
 * Rules:
 * - Only approved, owned Riot accounts count; an unverified claim never
 *   captures stats.
 * - PUUID wins over any name, since it survives Riot renames.
 * - Riot account names (primary, alts, aliases) win over display names.
 * - A name only resolves when exactly one profile answers to it at that
 *   level, so two players sharing a handle are never confused.
 * - The full `name#tag` is tried before the bare name.
 */

export type ProfileRow = {
  id: string
  display_name: string | null
}

/**
 * A Riot account owned by a profile (primary, alt or name alias). PUUID is the
 * stable key that survives a rename, so it takes priority over any name.
 */
export type RiotAccountRow = {
  profile_id: string
  riot_name: string
  riot_tag?: string | null
  riot_puuid?: string | null
}

/** Lowercased, trimmed, inner whitespace collapsed. The one name normalization. */
export function normalizeNameKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/** The bare name of a `name#tag`, normalized. */
export function baseNameKey(value: unknown): string {
  return normalizeNameKey(String(value ?? '').split('#')[0] ?? '')
}

/** Full then bare key for a name, without duplicates or blanks. */
export function nameKeys(value: string | null | undefined): string[] {
  return [...new Set([normalizeNameKey(value), baseNameKey(value)])].filter(Boolean)
}

/** Every name an account may appear under: `name#tag` (when tagged) and the bare name. */
export function accountNames(account: Pick<RiotAccountRow, 'riot_name' | 'riot_tag'>): string[] {
  const name = String(account.riot_name ?? '').trim()
  if (!name) return []
  const tag = String(account.riot_tag ?? '').trim()
  return tag ? [`${name}#${tag}`, name] : [name]
}

const ACCOUNT_SELECT = 'profile_id, riot_name, riot_tag, riot_puuid:puuid'
const ID_CHUNK = 100

/**
 * Approved, owned Riot accounts, paged past the row cap. Pass `profileIds` to
 * limit to those profiles (chunked so the filter stays within URL limits).
 */
export async function loadApprovedRiotAccounts(profileIds?: string[]): Promise<RiotAccountRow[]> {
  const base = () =>
    supabaseAdmin
      .from('riot_accounts')
      .select(ACCOUNT_SELECT)
      .not('profile_id', 'is', null)
      .eq('status', 'approved')

  try {
    if (!profileIds) {
      return await fetchAllRows<RiotAccountRow>(() => base().order('id'))
    }
    const ids = [...new Set(profileIds.filter(Boolean))]
    const rows: RiotAccountRow[] = []
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK)
      rows.push(
        ...(await fetchAllRows<RiotAccountRow>(() => base().in('profile_id', chunk).order('id')))
      )
    }
    return rows
  } catch {
    throw new Error('Failed to load Riot accounts')
  }
}

/** Every profile's display name, paged past the row cap. */
export async function loadProfileNames(): Promise<ProfileRow[]> {
  try {
    return await fetchAllRows<ProfileRow>(() =>
      supabaseAdmin.from('profiles').select('id, display_name').order('id')
    )
  } catch {
    throw new Error('Failed to load profiles')
  }
}

export type IdentityIndex = {
  /** PUUID first, then name; null when nothing (or more than one profile) matches. */
  resolve(playerName: string | null | undefined, puuid?: string | null): string | null
  resolveByPuuid(puuid: string): string | null
}

type NameTier = Map<string, Set<string>>

function addToTier(tier: NameTier, name: string | null | undefined, profileId: string) {
  for (const key of nameKeys(name)) {
    const owners = tier.get(key) ?? new Set<string>()
    owners.add(profileId)
    tier.set(key, owners)
  }
}

/** Build the resolver from already-loaded rows (pure, for tests and batch callers). */
export function buildIdentityIndex(
  profiles: ProfileRow[],
  accounts: RiotAccountRow[] = []
): IdentityIndex {
  const byPuuid = new Map<string, string>()
  const accountTier: NameTier = new Map()
  const displayTier: NameTier = new Map()

  for (const profile of profiles) addToTier(displayTier, profile.display_name, profile.id)
  for (const account of accounts) {
    if (account.riot_puuid) byPuuid.set(account.riot_puuid, account.profile_id)
    for (const name of accountNames(account)) addToTier(accountTier, name, account.profile_id)
  }

  return {
    resolve(playerName, puuid) {
      if (puuid) {
        const owner = byPuuid.get(puuid)
        if (owner) return owner
      }
      for (const key of nameKeys(playerName)) {
        for (const tier of [accountTier, displayTier]) {
          const owners = tier.get(key)
          if (!owners) continue
          // Ambiguous at the most specific level that matched: a looser key or
          // a lower tier would only guess, so give up.
          return owners.size === 1 ? [...owners][0]! : null
        }
      }
      return null
    },
    resolveByPuuid(puuid) {
      return byPuuid.get(puuid) ?? null
    },
  }
}

/** Load every approved account and profile name and build the resolver. */
export async function loadIdentityIndex(): Promise<IdentityIndex> {
  const [profiles, accounts] = await Promise.all([loadProfileNames(), loadApprovedRiotAccounts()])
  return buildIdentityIndex(profiles, accounts)
}

/** Escape `%`, `_` and `\` so an `ilike` compares the name literally. */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * Resolve a single name without loading the whole index: an approved Riot
 * account name first, then a display name. Like the index, a name more than
 * one profile answers to resolves to nothing.
 */
export async function findProfileIdByName(playerName: string): Promise<string | null> {
  const name = playerName.trim()
  if (!name) return null
  const pattern = likeLiteral(name)

  const { data: accounts, error: accountsError } = await supabaseAdmin
    .from('riot_accounts')
    .select('profile_id')
    .not('profile_id', 'is', null)
    .eq('status', 'approved')
    .ilike('riot_name', pattern)
    .limit(20)
  if (accountsError) throw new Error('Failed to load Riot accounts for name matching')
  const accountOwners = new Set((accounts ?? []).map((a) => a.profile_id as string))
  if (accountOwners.size > 0) return accountOwners.size === 1 ? [...accountOwners][0]! : null

  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .ilike('display_name', pattern)
    .limit(2)
  if (profilesError) throw new Error('Failed to load profiles for name matching')
  return profiles?.length === 1 ? (profiles[0].id as string) : null
}
