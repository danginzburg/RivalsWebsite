/** Parse a non-negative integer from a query string; invalid values return `fallback`. */
export function safeInt(value: string | null, fallback: number): number {
  if (!value) return fallback
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

/** Coerce unknown numeric DB values to integers, defaulting to 0 (e.g. leaderboard rows). */
export function safeNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}
