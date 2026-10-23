import { queryProfilesWithOptionalRiotIdBase } from '$lib/server/supabase/profiles'
import { loadRiotLinks, type RiotLink } from '$lib/server/players/riot-accounts'
import {
  listUnclaimedIdentities,
  type UnclaimedIdentity,
} from '$lib/server/players/riot-identities'
import { IDENTITY_USER_PREFIX, type AdminUser } from '$lib/admin/types'

type AdminUserRow = {
  id: string
  email: string | null
  display_name: string | null
  role: string | null
  riot_id_base: string | null
  riot_tag?: string | null
  created_at: string | null
}

/**
 * Every profile for the admin Users tab, with its linked Riot ID. Shared by the
 * admin page's first load and `/api/admin/users` (the Refresh path) so both
 * show the same thing.
 */
export async function listAdminUsers(): Promise<AdminUser[]> {
  const users = await queryProfilesWithOptionalRiotIdBase<AdminUserRow>({
    selectWithRiot: 'id, email, display_name, role, riot_id_base, riot_tag, created_at',
    selectWithoutRiot: 'id, email, display_name, role, created_at',
    order: { column: 'created_at', ascending: false },
    fatalMessage: 'Failed to fetch users',
  })

  // The real, PUUID-backed Riot ID. `riot_id_base` is a legacy name field that
  // often just mirrors the display name, so it is only a fallback label.
  let links = new Map<string, RiotLink>()
  try {
    links = await loadRiotLinks()
  } catch (err) {
    console.warn('Failed to load Riot links for admin users:', err)
  }

  // Players who have never logged in exist only as a PUUID identity; list them
  // too so an admin can name them ahead of their first login.
  let unclaimed: UnclaimedIdentity[] = []
  try {
    unclaimed = await listUnclaimedIdentities()
  } catch (err) {
    console.warn('Failed to load unclaimed identities for admin users:', err)
  }

  const profileUsers: AdminUser[] = (users || []).map((u) => {
    const link = links.get(u.id)
    return {
      ...u,
      role: u.role ?? 'user',
      created_at: u.created_at ?? '',
      riot_id:
        link?.riotId ??
        (u.riot_id_base ? `${u.riot_id_base}${u.riot_tag ? `#${u.riot_tag}` : ''}` : null),
      riot_linked: Boolean(link),
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
      riot_id_base: name,
      riot_tag: tag,
      riot_id: name ? `${name}${tag ? `#${tag}` : ''}` : null,
      riot_linked: true,
      unclaimed: true,
      created_at: i.first_seen_at ?? '',
    }
  })

  return [...profileUsers, ...identityUsers]
}
