/**
 * A season's map pool lives on `seasons.metadata.map_pool` (map display names),
 * with `metadata.map_pool_mode` saying where it comes from:
 *   - 'custom': the admin picks the maps by hand.
 *   - 'competitive': the pool follows Valorant's ranked rotation. Maps are added
 *     as they enter the rotation and never removed, so a map that rotates out
 *     mid-season stays in that season's pool.
 * Seasons saved before the mode existed are 'custom'.
 */

export type MapPoolMode = 'competitive' | 'custom'

export function normalizeMapPoolMode(value: unknown): MapPoolMode {
  return value === 'competitive' ? 'competitive' : 'custom'
}

export function resolveMapPoolMode(
  metadata: Record<string, unknown> | null | undefined
): MapPoolMode {
  return normalizeMapPoolMode(metadata?.map_pool_mode)
}

/** Trimmed, de-duplicated map names, in order. */
export function sanitizeMapPool(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of value) {
    const name = typeof raw === 'string' ? raw.trim() : ''
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

export function resolveMapPool(metadata: Record<string, unknown> | null | undefined): string[] {
  return sanitizeMapPool(metadata?.map_pool)
}

/**
 * The existing pool plus any rotation map it lacks. Nothing is ever dropped:
 * a map that left the rotation stays, because it was played this season.
 */
export function mergeRotationIntoPool(pool: string[], rotation: string[]): string[] {
  return sanitizeMapPool([...pool, ...rotation])
}
