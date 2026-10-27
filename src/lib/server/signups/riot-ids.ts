import { loadPlayerDirectory } from '$lib/server/players/directory'

/**
 * A signup's Riot ID is the player's primary Riot account, not a copy kept on
 * the signup. Attaches it as `display_name` (the Riot name) and `riot_tag`, the
 * shape the signup UI, CSV export and rating lookup have always read.
 */
export async function withSignupRiotIds<T extends { profile_id: string }>(
  rows: T[]
): Promise<Array<T & { display_name: string | null; riot_tag: string | null }>> {
  const directory = await loadPlayerDirectory(rows.map((r) => r.profile_id))
  return rows.map((row) => {
    const player = directory.get(row.profile_id)
    return { ...row, display_name: player?.riot_name ?? null, riot_tag: player?.riot_tag ?? null }
  })
}
