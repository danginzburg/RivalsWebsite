import { supabaseAdmin } from '$lib/supabase/admin'
import { fetchAllRows } from '$lib/server/supabase/fetch-all'

/**
 * One row per player, from the `player_directory` view: the profile (display
 * name, login, Discord) joined to its primary Riot account, every approved
 * Riot ID and PUUID, and the latest signup. Use it — or `lookupPlayer` — for
 * any "who is this?" question instead of reading profiles and Riot accounts
 * separately.
 */
export type PlayerDirectoryEntry = {
  profile_id: string
  display_name: string | null
  display_name_is_custom: boolean
  email: string | null
  avatar_url: string | null
  role: string | null
  discord_id: string | null
  discord_username: string | null
  /** The primary Riot account. */
  riot_name: string | null
  riot_tag: string | null
  puuid: string | null
  /** Every approved account, primary first. */
  puuids: string[]
  riot_ids: string[]
  latest_signup_season_id: string | null
  latest_signup_status: 'pending' | 'approved' | 'rejected' | null
  latest_signup_discord_handle: string | null
}

const DIRECTORY_COLUMNS = `
  profile_id, display_name, display_name_is_custom, email, avatar_url, role,
  discord_id, discord_username, riot_name, riot_tag, puuid, puuids, riot_ids,
  latest_signup_season_id, latest_signup_status, latest_signup_discord_handle
`

/** Directory rows for these profiles (or every player), keyed by profile id. */
export async function loadPlayerDirectory(
  profileIds?: string[]
): Promise<Map<string, PlayerDirectoryEntry>> {
  const rows: PlayerDirectoryEntry[] = []
  if (profileIds) {
    const ids = [...new Set(profileIds.filter(Boolean))]
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await supabaseAdmin
        .from('player_directory')
        .select(DIRECTORY_COLUMNS)
        .in('profile_id', ids.slice(i, i + 100))
      if (error) throw new Error('Failed to load player directory')
      rows.push(...((data ?? []) as unknown as PlayerDirectoryEntry[]))
    }
  } else {
    rows.push(
      ...(await fetchAllRows<PlayerDirectoryEntry>(() =>
        supabaseAdmin.from('player_directory').select(DIRECTORY_COLUMNS).order('profile_id')
      ))
    )
  }
  return new Map(rows.map((r) => [r.profile_id, r]))
}

export type PlayerLookup =
  | { profileId: string }
  | { puuid: string }
  /** `name#tag`, or a bare name matched against tagless and tagged accounts. */
  | { riotId: string }
  | { discordId: string }
  | { discordUsername: string }

/**
 * Resolve any identifier we hold for a player to their directory entry. Riot
 * IDs and PUUIDs resolve through every approved account (alts included), so a
 * renamed or smurfing player is still found. Returns null for an identity no
 * profile owns.
 */
export async function lookupPlayer(key: PlayerLookup): Promise<PlayerDirectoryEntry | null> {
  const profileId = await resolveProfileId(key)
  if (!profileId) return null
  return (await loadPlayerDirectory([profileId])).get(profileId) ?? null
}

async function resolveProfileId(key: PlayerLookup): Promise<string | null> {
  if ('profileId' in key) return key.profileId.trim() || null

  if ('discordId' in key || 'discordUsername' in key) {
    const [column, value] =
      'discordId' in key
        ? ['discord_id', key.discordId.trim()]
        : ['discord_username', key.discordUsername.trim()]
    if (!value) return null
    const { data } = await supabaseAdmin.from('profiles').select('id').ilike(column, value).limit(1)
    return (data?.[0]?.id as string | undefined) ?? null
  }

  let query = supabaseAdmin
    .from('riot_accounts')
    .select('profile_id')
    .not('profile_id', 'is', null)
    .eq('status', 'approved')

  if ('puuid' in key) {
    const puuid = key.puuid.trim()
    if (!puuid) return null
    query = query.eq('puuid', puuid)
  } else {
    const [name, tag] = key.riotId.split('#').map((part) => part.trim())
    if (!name) return null
    query = query.ilike('riot_name', name)
    if (tag) query = query.ilike('riot_tag', tag)
  }

  const { data } = await query.order('is_primary', { ascending: false }).limit(1)
  return (data?.[0]?.profile_id as string | undefined) ?? null
}

/**
 * Every approved Riot name (bare and `name#tag`) each profile is known by, for
 * name matching against stat rows that carry no PUUID.
 */
export async function riotNamesByProfile(profileIds: string[]): Promise<Map<string, string[]>> {
  const names = new Map<string, string[]>()
  const ids = [...new Set(profileIds.filter(Boolean))]
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabaseAdmin
      .from('riot_accounts')
      .select('profile_id, riot_name, riot_tag')
      .in('profile_id', ids.slice(i, i + 100))
      .eq('status', 'approved')
    if (error) throw new Error('Failed to load Riot account names')
    for (const row of data ?? []) {
      const name = String(row.riot_name ?? '').trim()
      if (!name) continue
      const list = names.get(row.profile_id) ?? []
      list.push(name)
      if (row.riot_tag) list.push(`${name}#${row.riot_tag}`)
      names.set(row.profile_id, list)
    }
  }
  return names
}
