/**
 * Map art from valorant-api.com, used to illustrate the map-veto list.
 *
 * The public API needs no key. We fetch the full map list once and cache it for
 * the server's lifetime (refreshed daily), so a page with a veto only ever pays
 * for the request the first time — and never if the veto has no maps to show.
 */

/** A single Valorant map's name and art URLs (hosted on the api's CDN). */
export type ValorantMapArt = {
  displayName: string
  /** Loading-screen key art — landscape, but ~3MB, so unused for thumbnails. */
  splash: string
  /** Light (~80KB) list thumbnail shown on the veto; falls back to splash. */
  listViewIcon: string
  /**
   * A standard 5v5 competitive (Search & Destroy) map. The api's list also
   * carries TDM maps, the practice range, and basic training; only the
   * competitive maps carry a `tacticalDescription`, which is what we key on.
   */
  competitive: boolean
}

type MapLookup = Map<string, ValorantMapArt>

const MAPS_URL = 'https://valorant-api.com/v1/maps'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 4000

let cache: { at: number; lookup: MapLookup } | null = null
let inFlight: Promise<MapLookup> | null = null

/** Collapse a name to a comparison key: lowercase, letters and digits only. */
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function fetchLookup(): Promise<MapLookup> {
  const lookup: MapLookup = new Map()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(MAPS_URL, { signal: controller.signal })
    if (!res.ok) return lookup
    const body = (await res.json()) as {
      data?: Array<{
        displayName?: string
        splash?: string
        listViewIcon?: string
        tacticalDescription?: string | null
      }>
    }
    for (const map of body.data ?? []) {
      if (!map.displayName || !map.splash) continue
      lookup.set(normalize(map.displayName), {
        displayName: map.displayName,
        splash: map.splash,
        listViewIcon: map.listViewIcon ?? map.splash,
        competitive: Boolean(map.tacticalDescription),
      })
    }
  } catch {
    // Offline or timed out — the caller falls back to plain veto text.
  } finally {
    clearTimeout(timer)
  }
  return lookup
}

/**
 * Cached map-name → art lookup. A failed fetch is not cached, so the next
 * veto-bearing page retries rather than showing text for a whole day.
 */
export async function getValorantMapLookup(): Promise<MapLookup> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.lookup
  if (inFlight) return inFlight
  inFlight = fetchLookup()
    .then((lookup) => {
      if (lookup.size > 0) cache = { at: Date.now(), lookup }
      return cache?.lookup ?? lookup
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/**
 * Competitive map-art list, sorted by name — the source for the admin map-pool
 * picker. TDM maps, the range, and basic training are filtered out so a season
 * pool can only be built from standard 5v5 competitive maps. Empty when the
 * fetch fails, so callers should treat an empty list as "not loaded" rather
 * than "no maps exist".
 */
export async function getValorantMapList(): Promise<ValorantMapArt[]> {
  const lookup = await getValorantMapLookup()
  return Array.from(lookup.values())
    .filter((map) => map.competitive)
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
}

/** One map-pool entry resolved against the art list. */
export type MapPoolEntry = {
  /** Canonical map name when recognized, otherwise the stored string as-is. */
  name: string
  /** Landscape splash art URL, or null when the name isn't a known map. */
  image: string | null
}

/**
 * Resolve a season's stored map-pool names to art, keeping the admin's order.
 * Uses the landscape splash art — the pool is a showcase of a handful of maps,
 * not a dense thumbnail list, so the larger key art reads better. An
 * unrecognized name still renders, it just carries no image.
 */
export function resolveMapPool(names: string[], lookup: MapLookup): MapPoolEntry[] {
  return names.map((name) => {
    const art = lookup.get(normalize(name))
    return { name: art?.displayName ?? name, image: art?.splash ?? null }
  })
}

/** What a veto line does to its map — drives the pick/ban color scheme. */
export type VetoAction = 'ban' | 'pick' | 'decider' | null

/** A veto line resolved against the map list. */
export type VetoStep = {
  /** The raw admin line, kept as the accessible label and text fallback. */
  text: string
  /** Canonical map name, when one was recognized in the line. */
  mapName: string | null
  /** Map thumbnail URL (list-view art), or null when unrecognized. */
  image: string | null
  /** The line minus the map name, e.g. "Ban: Team A" — null when there's none. */
  label: string | null
  /** Ban / pick / decider, sniffed from the line so the UI can color it. */
  action: VetoAction
}

/**
 * Classify a veto line as a ban, pick, or decider from its wording. Admin lines
 * are free-form ("Ban: Team A - Haven", "Decider", "Team B picks Lotus"), so we
 * just look for the verb anywhere in the line.
 */
function detectVetoAction(text: string): VetoAction {
  const lower = text.toLowerCase()
  if (/\bban(?:s|ned|ning)?\b/.test(lower)) return 'ban'
  if (/\b(?:decider|deciding|remaining|leftover)\b/.test(lower)) return 'decider'
  if (/\bpick(?:s|ed|ing)?\b/.test(lower)) return 'pick'
  return null
}

/**
 * Pull the map (and the surrounding action text) out of one veto line.
 *
 * Lines are free-form admin text like "Ban: Team A - Haven", so rather than
 * assume a shape we look for any known map name inside the line. The longest
 * match wins, so a line that happens to mention two names resolves to the
 * more specific one.
 */
export function parseVetoLine(line: string, lookup: MapLookup): VetoStep {
  const text = line.trim()

  let best: ValorantMapArt | null = null
  for (const art of lookup.values()) {
    const re = new RegExp(`\\b${escapeRegExp(art.displayName)}\\b`, 'i')
    if (!re.test(text)) continue
    if (!best || art.displayName.length > best.displayName.length) best = art
  }

  if (!best)
    return { text, mapName: null, image: null, label: null, action: detectVetoAction(text) }

  const label = text
    .replace(new RegExp(`\\b${escapeRegExp(best.displayName)}\\b`, 'i'), '')
    .replace(/^[\s:_—–-]+|[\s:_—–-]+$/g, '')
    .trim()

  return {
    text,
    mapName: best.displayName,
    image: best.listViewIcon,
    label: label || null,
    action: detectVetoAction(text),
  }
}
