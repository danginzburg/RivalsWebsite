/** Shared between the search palette's compare tray and the /compare page. */

export type CompareKind = 'players' | 'teams'

/**
 * Most items one comparison shows. The maths handles any number; past five
 * the side-by-side columns and the head-to-head grid stop being readable.
 */
export const MAX_COMPARE = 5

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Parse `?ids=` into distinct UUIDs, capped at MAX_COMPARE, keeping their order. */
export function parseCompareIds(raw: string | null): string[] {
  const ids: string[] = []
  for (const part of (raw ?? '').split(',')) {
    const id = part.trim().toLowerCase()
    if (UUID_RE.test(id) && !ids.includes(id)) ids.push(id)
    if (ids.length === MAX_COMPARE) break
  }
  return ids
}

export function parseCompareKind(raw: string | null): CompareKind {
  return raw === 'teams' ? 'teams' : 'players'
}

/** The /compare URL for these items (path plus query, for `goto` or an href). */
export function compareHref(kind: CompareKind, ids: string[], batchId?: string | null): string {
  const params = new URLSearchParams({ type: kind, ids: ids.join(',') })
  if (batchId) params.set('batchId', batchId)
  return `/compare?${params.toString()}`
}
