const START_ROUNDING_MS = 15 * 60_000

/**
 * Round a match start to the nearest quarter hour.
 *
 * Riot stamps the second the map loaded (19:07:43), which reads badly as a
 * match time; the league schedules on round numbers, so snap to them. Returns
 * the input untouched when it is missing or unparseable.
 */
export function roundStartTime(startedAt: string | null): string | null {
  if (!startedAt) return startedAt
  const ms = new Date(startedAt).getTime()
  if (!Number.isFinite(ms)) return startedAt
  return new Date(Math.round(ms / START_ROUNDING_MS) * START_ROUNDING_MS).toISOString()
}
