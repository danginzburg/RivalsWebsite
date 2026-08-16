type StatsRowIdentity = {
  id?: unknown
  profile_id?: unknown
  player_name?: unknown
}

/**
 * A player's name without the Riot tagline.
 *
 * Riot-imported rows store the full `name#tag` because that is what identifies
 * an account, while CSV-imported rows have only the name. Scoreboards read
 * better with just the name, and stripping here keeps the two import sources
 * looking the same. Matching and links still use the stored value.
 */
export function displayPlayerName(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!text) return 'Player'
  const hash = text.lastIndexOf('#')
  // Guard against a name that starts with '#': that hash is not a tag marker.
  return hash > 0 ? text.slice(0, hash) : text
}

function keyPart(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text ? text : null
}

export function statsRowKey(row: StatsRowIdentity, index: number): string {
  const id = keyPart(row.id)
  if (id) return `row:${id}`

  const profileId = keyPart(row.profile_id)
  if (profileId) return `profile:${profileId}:${index}`

  const playerName = keyPart(row.player_name)
  if (playerName) return `player:${playerName}:${index}`

  return `index:${index}`
}
