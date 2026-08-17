/**
 * The name a profile is shown under across the site.
 *
 * `display_name` is the player's chosen name (seeded from their primary Riot
 * name), so it wins. `riot_id_base` and `email` are only fallbacks for profiles
 * that never set one. Kept in one place so every surface agrees.
 */
export function resolveProfileName(
  profile:
    | {
        display_name?: string | null
        riot_id_base?: string | null
        email?: string | null
      }
    | null
    | undefined,
  fallback = 'Player'
): string {
  return profile?.display_name || profile?.riot_id_base || profile?.email || fallback
}
