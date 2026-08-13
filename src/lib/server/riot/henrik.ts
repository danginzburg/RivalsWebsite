import { env } from '$env/dynamic/private'
import { TtlCache } from '$lib/server/cache'
import { toLeagueRank } from './rank-map'

/**
 * Thin client for the HenrikDev Valorant API.
 *
 * Third-party and unaffiliated with Riot. An API key is optional for the
 * endpoints used here but raises the rate limit, so it is read from
 * HENRIKDEV_API_KEY when present.
 */

const BASE = 'https://api.henrikdev.xyz/valorant'

/** Riot account and MMR change slowly; a short cache keeps lookups cheap. */
const accountCache = new TtlCache<RiotAccount | null>({ ttlMs: 10 * 60_000, maxEntries: 500 })
const mmrCache = new TtlCache<RiotRank | null>({ ttlMs: 5 * 60_000, maxEntries: 500 })

export type RiotAccount = {
  puuid: string
  name: string
  tag: string
  region: string | null
  accountLevel: number | null
}

export type RiotRank = {
  currentTier: string | null
  /** League rank name, or null when the tier does not map. */
  currentRank: string | null
  currentRr: number | null
  peakTier: string | null
  peakRank: string | null
  /** Season the peak was set in, when reported. */
  peakSeason: string | null
  /**
   * Riot's canonical season UUID for the peak act. tracker.gg keys its acts by
   * the same UUID, so this is what links a peak rank to the tracker score from
   * that act — the short names differ between the two services.
   */
  peakSeasonId: string | null
}

export class RiotLookupError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function headers(): Record<string, string> {
  const key = env.HENRIKDEV_API_KEY
  return key ? { Authorization: key } : {}
}

/** Split "name#tag" into its parts. Accepts an already-split pair too. */
export function parseRiotId(input: string): { name: string; tag: string } {
  const raw = String(input ?? '').trim()
  const hash = raw.lastIndexOf('#')
  if (hash <= 0 || hash === raw.length - 1) {
    throw new RiotLookupError(400, 'Enter a full Riot ID in the form name#tag')
  }
  return { name: raw.slice(0, hash).trim(), tag: raw.slice(hash + 1).trim() }
}

async function request<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: headers(),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    // Network failure or timeout — the caller should offer a retry, not treat
    // this as "player not found".
    throw new RiotLookupError(503, 'Could not reach the Riot lookup service. Try again shortly.')
  }

  if (response.status === 404) {
    throw new RiotLookupError(404, 'No Riot account found with that name and tag.')
  }
  if (response.status === 429) {
    throw new RiotLookupError(429, 'Riot lookup is rate limited right now. Try again in a minute.')
  }
  if (!response.ok) {
    throw new RiotLookupError(502, `Riot lookup failed (HTTP ${response.status}).`)
  }

  const payload = (await response.json().catch(() => null)) as { data?: T } | null
  if (!payload?.data) {
    throw new RiotLookupError(502, 'Riot lookup returned an unexpected response.')
  }
  return payload.data
}

type AccountPayload = {
  puuid: string
  name: string
  tag: string
  region?: string | null
  account_level?: number | null
}

/** Verify a Riot ID exists and capture its PUUID. */
export async function fetchAccount(name: string, tag: string): Promise<RiotAccount> {
  const key = `${name.toLowerCase()}#${tag.toLowerCase()}`
  const cached = accountCache.get(key)
  if (cached) return cached

  const data = await request<AccountPayload>(
    `/v1/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`
  )

  const account: RiotAccount = {
    puuid: data.puuid,
    name: data.name,
    tag: data.tag,
    region: data.region ?? null,
    accountLevel: data.account_level ?? null,
  }

  accountCache.set(key, account)
  return account
}

type MmrPayload = {
  current?: {
    tier?: { name?: string | null } | null
    rr?: number | null
  } | null
  peak?: {
    tier?: { name?: string | null } | null
    season?: { short?: string | null; id?: string | null } | null
  } | null
}

/**
 * Current and peak competitive rank.
 * Region comes from the account lookup; `na` is the fallback.
 */
export async function fetchRank(
  name: string,
  tag: string,
  region: string | null
): Promise<RiotRank> {
  const resolvedRegion = (region || 'na').toLowerCase()
  const key = `${resolvedRegion}:${name.toLowerCase()}#${tag.toLowerCase()}`
  const cached = mmrCache.get(key)
  if (cached) return cached

  const data = await request<MmrPayload>(
    `/v3/mmr/${encodeURIComponent(resolvedRegion)}/pc/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`
  )

  const currentTier = data.current?.tier?.name ?? null
  const peakTier = data.peak?.tier?.name ?? null

  const rank: RiotRank = {
    currentTier,
    currentRank: toLeagueRank(currentTier),
    currentRr: data.current?.rr ?? null,
    peakTier,
    peakRank: toLeagueRank(peakTier),
    peakSeason: data.peak?.season?.short ?? null,
    peakSeasonId: data.peak?.season?.id ?? null,
  }

  mmrCache.set(key, rank)
  return rank
}

/** Account plus rank in one call, for the admin lookup button. */
export async function lookupPlayer(riotId: string) {
  const { name, tag } = parseRiotId(riotId)
  const account = await fetchAccount(name, tag)

  // A missing competitive record is not a failed lookup — the account is
  // still valid, there is just no rank to fill in.
  let rank: RiotRank | null = null
  try {
    rank = await fetchRank(account.name, account.tag, account.region)
  } catch (err) {
    if (!(err instanceof RiotLookupError) || err.status !== 404) throw err
  }

  return { account, rank }
}
