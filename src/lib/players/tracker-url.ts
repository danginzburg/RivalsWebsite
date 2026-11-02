/**
 * A player's tracker.gg profile URL.
 *
 * Built from the current Riot ID rather than a stored URL, so it follows
 * renames along with the account. Shared by the profile panel and the signup
 * form's prefill so both link to the same page.
 */
export function trackerProfileUrl(
  riotName: string | null | undefined,
  riotTag: string | null | undefined
): string | null {
  if (!riotName || !riotTag) return null
  return `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(
    `${riotName}#${riotTag}`
  )}/overview`
}

/** The Riot ID in a tracker.gg Valorant profile URL, or null for any other link. */
export function riotIdFromTrackerUrl(url: string): { name: string; tag: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.hostname.replace(/^www\./, '') !== 'tracker.gg') return null

  const segment = /^\/valorant\/profile\/riot\/([^/]+)/.exec(parsed.pathname)?.[1]
  if (!segment) return null

  let riotId: string
  try {
    riotId = decodeURIComponent(segment)
  } catch {
    return null
  }
  // A pasted URL with a bare # puts the tag in the fragment.
  if (!riotId.includes('#')) riotId += parsed.hash.split('/')[0]

  const hash = riotId.lastIndexOf('#')
  const name = riotId.slice(0, Math.max(hash, 0)).trim()
  const tag = riotId.slice(hash + 1).trim()
  return name && tag ? { name, tag } : null
}

/** Compares Riot IDs regardless of case. */
export const riotIdKey = (name: string, tag: string) => `${name}#${tag}`.toLowerCase()

/** The Riot IDs in these tracker links that are not in `known` keys, without repeats. */
export function newRiotIdsFromTrackerLinks(
  links: Array<{ url: string }>,
  known: Iterable<string>
): Array<{ name: string; tag: string }> {
  const seen = new Set(known)
  const found: Array<{ name: string; tag: string }> = []

  for (const link of links) {
    const riotId = riotIdFromTrackerUrl(link.url)
    if (!riotId) continue

    const key = riotIdKey(riotId.name, riotId.tag)
    if (seen.has(key)) continue
    seen.add(key)
    found.push(riotId)
  }

  return found
}
