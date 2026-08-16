/**
 * Pull a Riot match UUID out of whatever an admin pasted.
 *
 * tracker.gg match URLs end in the same UUID Riot uses, so a tracker link and a
 * bare match id are the same input once the surrounding URL is stripped. This
 * is deliberately permissive about the host: valorant.op.gg, blitz.gg and
 * tracker all put the match id in the path, and there is no benefit to
 * rejecting one of them over a pattern match that already has to be exact.
 */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** The last UUID in the string, or null. */
export function parseMatchId(input: string): string | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null

  // A URL can carry more than one UUID (a profile id *and* a match id, as
  // tracker.gg does). The match id is the last one in the path.
  const matches = raw.match(new RegExp(UUID_RE, 'gi'))
  if (!matches || matches.length === 0) return null

  return matches[matches.length - 1].toLowerCase()
}

/**
 * Parse a whole textarea of links or ids into a de-duplicated list, preserving
 * the order they were pasted in so a best-of-three keeps its map order.
 */
export function parseMatchIdList(input: string): { ids: string[]; unparsed: string[] } {
  const ids: string[] = []
  const unparsed: string[] = []
  const seen = new Set<string>()

  for (const line of String(input ?? '').split(/[\s,]+/)) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const id = parseMatchId(trimmed)
    if (!id) {
      unparsed.push(trimmed)
      continue
    }
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }

  return { ids, unparsed }
}
