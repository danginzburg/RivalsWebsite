type StatsRowIdentity = {
  id?: unknown
  profile_id?: unknown
  player_name?: unknown
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
