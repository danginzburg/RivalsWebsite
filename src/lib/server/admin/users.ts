import { loadRiotLinks, type RiotLink } from '$lib/server/players/riot-accounts'
import {
  listUnclaimedIdentities,
  type UnclaimedIdentity,
} from '$lib/server/players/riot-identities'
import { loadPlayerDirectory, type PlayerDirectoryEntry } from '$lib/server/players/directory'
import { supabaseAdmin } from '$lib/supabase/admin'
import { IDENTITY_USER_PREFIX, type AdminUser } from '$lib/admin/types'

function formatRiotId(name: string | null, tag: string | null): string | null {
  return name ? `${name}${tag ? `#${tag}` : ''}` : null
}

/** Every Riot ID and Discord name the directory holds for a player, deduped. */
function aliasesOf(entry: PlayerDirectoryEntry | undefined): string[] {
  if (!entry) return []
  const names = [
    ...(entry.riot_ids ?? []),
    entry.discord_username,
    entry.latest_signup_discord_handle,
  ]
  return [...new Set(names.map((n) => n?.trim()).filter((n): n is string => Boolean(n)))]
}

/**
 * Every profile for the admin Users tab, with its linked Riot ID. Shared by the
 * admin page's first load and `/api/admin/users` (the Refresh path) so both
 * show the same thing.
 */
export async function listAdminUsers(): Promise<AdminUser[]> {
  const { data: users, error } = await supabaseAdmin
    .from('profiles')
    .select('id, email, display_name, role, created_at')
    .order('created_at', { ascending: false })
  if (error) throw new Error('Failed to fetch users')

  // The PUUID-backed Riot ID wins; a primary account that never verified is
  // still shown, as a name only.
  let links = new Map<string, RiotLink>()
  let directory = new Map<string, PlayerDirectoryEntry>()
  try {
    ;[links, directory] = await Promise.all([loadRiotLinks(), loadPlayerDirectory()])
  } catch (err) {
    console.warn('Failed to load Riot accounts for admin users:', err)
  }

  // Players who have never logged in exist only as a Riot account no profile
  // owns; list them too so an admin can name them ahead of their first login.
  let unclaimed: UnclaimedIdentity[] = []
  try {
    unclaimed = await listUnclaimedIdentities()
  } catch (err) {
    console.warn('Failed to load unclaimed identities for admin users:', err)
  }

  const profileUsers: AdminUser[] = (users ?? []).map((u) => {
    // Name and tag always come from the same account, so a tag is never shown
    // against another account's name.
    const link = links.get(u.id)
    const primary = directory.get(u.id)
    const name = link?.riotName ?? primary?.riot_name ?? null
    const tag = link ? link.riotTag : (primary?.riot_tag ?? null)
    return {
      ...u,
      role: u.role ?? 'user',
      created_at: u.created_at ?? '',
      riot_tag: tag,
      riot_id: formatRiotId(name, tag),
      riot_linked: Boolean(link),
      aliases: aliasesOf(primary),
    }
  })

  const identityUsers: AdminUser[] = unclaimed.map((i) => {
    const name = i.latest_name?.trim() || null
    const tag = i.latest_tag?.trim() || null
    return {
      id: `${IDENTITY_USER_PREFIX}${i.puuid}`,
      email: null,
      display_name: i.display_name || name,
      role: 'user',
      riot_tag: tag,
      riot_id: formatRiotId(name, tag),
      riot_linked: true,
      unclaimed: true,
      created_at: i.first_seen_at ?? '',
    }
  })

  return [...profileUsers, ...identityUsers]
}
