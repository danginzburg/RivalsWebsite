/**
 * The name a profile is shown under across the site.
 *
 * `display_name` is the player's chosen name (seeded from their primary Riot
 * name), so it wins. `email` is only a fallback for profiles
 * that never set one. Kept in one place so every surface agrees.
 */
export function resolveProfileName(
  profile:
    | {
        display_name?: string | null
        email?: string | null
      }
    | null
    | undefined,
  fallback = 'Player'
): string {
  return profile?.display_name || profile?.email || fallback
}
