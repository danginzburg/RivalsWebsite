import { env } from '$env/dynamic/private'
import { TtlCache } from '$lib/server/cache'
import { toLeagueRank } from './rank-map'
import {
  peakRankBetween,
  summarizeRank,
  type MmrV3Payload,
  type StoredMmrEntry,
} from './rank-window'
import { RateLimitWaitError, RateLimiter } from './rate-limiter'

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
  /**
   * 'current' is the live rank; 'last-act' means the player is unrated now and
   * the rank is the end rank of their latest ranked act since V26 Act 1.
   */
  currentSource: 'current' | 'last-act' | null
  /** Act the fallback current rank came from, e.g. "V26 A4". */
  currentAct: string | null
  /** Highest tier reached since V26 Act 1. */
  peakTier: string | null
  peakRank: string | null
  /** Act the peak was reached in, e.g. "V26 A1". */
  peakSeason: string | null
}

export class RiotLookupError extends Error {
  status: number
  /** On a 429: how long until a request could go through, when known. */
  retryAfterMs: number | null
  constructor(status: number, message: string, retryAfterMs: number | null = null) {
    super(message)
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

function headers(): Record<string, string> {
  const key = env.HENRIKDEV_API_KEY
  return key ? { Authorization: key } : {}
}

/**
 * Every HenrikDev request in this process goes through this limiter. The key's
 * limit is 30 requests a minute; HENRIKDEV_RATE_LIMIT overrides the starting
 * value, and the limit the API reports in its headers replaces it after the
 * first response.
 */
const limiter = new RateLimiter({
  limitPerMinute: Number(env.HENRIKDEV_RATE_LIMIT) || 30,
})

/** How long an interactive lookup will queue for a slot before giving up. */
const DEFAULT_MAX_WAIT_MS = 20_000

/** Attempts per request, counting retries after a 429. */
const MAX_ATTEMPTS = 3

export type LookupOptions = {
  /**
   * Epoch ms after which the request should not start. Waiting for a rate-limit
   * slot that would land later throws a 429 RiotLookupError instead.
   */
  deadline?: number
}

export function rateLimitedError(retryAfterMs: number | null): RiotLookupError {
  return new RiotLookupError(
    429,
    'Riot lookup is rate limited right now. Try again in a minute.',
    retryAfterMs
  )
}

/**
 * Paced fetch against HenrikDev: waits for a slot, records the rate-limit
 * headers, and retries a 429 once the API says the window has reset — as long
 * as that is before the deadline. A 429 that cannot be waited out is returned
 * to the caller as-is.
 */
export async function henrikFetch(
  url: string,
  opts: LookupOptions & { timeoutMs: number; unreachableMessage: string }
): Promise<Response> {
  const deadline = opts.deadline ?? Date.now() + DEFAULT_MAX_WAIT_MS

  for (let attempt = 1; ; attempt++) {
    try {
      await limiter.acquire(Math.max(0, deadline - Date.now()))
    } catch (err) {
      if (err instanceof RateLimitWaitError) throw rateLimitedError(err.waitMs)
      throw err
    }

    let response: Response
    try {
      response = await fetch(url, {
        headers: headers(),
        signal: AbortSignal.timeout(opts.timeoutMs),
      })
    } catch {
      // Network failure or timeout — the caller should offer a retry, not treat
      // this as "player not found".
      throw new RiotLookupError(503, opts.unreachableMessage)
    }

    limiter.observe(response.headers, response.status)
    if (response.status !== 429 || attempt >= MAX_ATTEMPTS) return response
    // The next acquire waits out the block this 429 just set, or gives up at
    // the deadline.
  }
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

async function request<T>(path: string, opts: LookupOptions = {}): Promise<T> {
  const response = await henrikFetch(`${BASE}${path}`, {
    ...opts,
    timeoutMs: 10_000,
    unreachableMessage: 'Could not reach the Riot lookup service. Try again shortly.',
  })

  if (response.status === 404) {
    throw new RiotLookupError(404, 'No Riot account found with that name and tag.')
  }
  if (response.status === 429) throw rateLimitedError(limiter.blockedForMs || null)
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
export async function fetchAccount(
  name: string,
  tag: string,
  opts: LookupOptions = {}
): Promise<RiotAccount> {
  const key = `${name.toLowerCase()}#${tag.toLowerCase()}`
  const cached = accountCache.get(key)
  if (cached) return cached

  const data = await request<AccountPayload>(
    `/v1/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
    opts
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

function toRiotRank(data: MmrV3Payload): RiotRank {
  const summary = summarizeRank(data)
  const currentTier = summary.currentTier?.name ?? null
  const peakTier = summary.peakTier?.name ?? null

  return {
    currentTier,
    currentRank: toLeagueRank(currentTier),
    currentRr: summary.currentRr,
    currentSource: summary.currentSource,
    currentAct: summary.currentAct,
    peakTier,
    peakRank: toLeagueRank(peakTier),
    peakSeason: summary.peakAct,
  }
}

/**
 * Current rank and peak rank since V26 Act 1.
 * Region comes from the account lookup; `na` is the fallback.
 */
export async function fetchRank(
  name: string,
  tag: string,
  region: string | null,
  opts: LookupOptions = {}
): Promise<RiotRank> {
  const resolvedRegion = (region || 'na').toLowerCase()
  const key = `${resolvedRegion}:${name.toLowerCase()}#${tag.toLowerCase()}`
  const cached = mmrCache.get(key)
  if (cached) return cached

  const data = await request<MmrV3Payload>(
    `/v3/mmr/${encodeURIComponent(resolvedRegion)}/pc/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
    opts
  )

  const rank = toRiotRank(data)
  mmrCache.set(key, rank)
  return rank
}

export type RankLookup = {
  account: { name: string; tag: string; puuid: string | null }
  /** Null when the account has no competitive record. */
  rank: RiotRank | null
}

const puuidRankCache = new TtlCache<RankLookup>({ ttlMs: 5 * 60_000, maxEntries: 500 })

/**
 * Rank by PUUID — the identity stored when a player links their account. It
 * survives Riot name changes, so it is preferred over the name#tag on a signup.
 * The league is NA-only, so the region is fixed.
 */
export async function fetchRankByPuuid(
  puuid: string,
  opts: LookupOptions = {}
): Promise<RankLookup> {
  const cached = puuidRankCache.get(puuid)
  if (cached) return cached

  let data: MmrV3Payload | null = null
  try {
    data = await request<MmrV3Payload>(`/v3/by-puuid/mmr/na/pc/${encodeURIComponent(puuid)}`, opts)
  } catch (err) {
    // A 404 here means no competitive record, not a missing account — the
    // PUUID came from a verified link.
    if (!(err instanceof RiotLookupError) || err.status !== 404) throw err
  }

  const result: RankLookup = {
    account: {
      name: data?.account?.name ?? '',
      tag: data?.account?.tag ?? '',
      puuid,
    },
    rank: data ? toRiotRank(data) : null,
  }

  puuidRankCache.set(puuid, result)
  return result
}

const rankHistoryCache = new TtlCache<StoredMmrEntry[]>({ ttlMs: 10 * 60_000, maxEntries: 500 })

/** A player's stored ranked games, newest first as HenrikDev returns them. */
export async function fetchStoredMmrHistory(
  puuid: string,
  opts: LookupOptions = {}
): Promise<StoredMmrEntry[]> {
  const cached = rankHistoryCache.get(puuid)
  if (cached) return cached
  let history: StoredMmrEntry[]
  try {
    const data = await request<StoredMmrEntry[] | { history?: StoredMmrEntry[] }>(
      `/v2/by-puuid/stored-mmr-history/na/pc/${encodeURIComponent(puuid)}`,
      opts
    )
    history = Array.isArray(data) ? data : (data.history ?? [])
  } catch (err) {
    // No ranked record at all is an answer, not a failure.
    if (!(err instanceof RiotLookupError) || err.status !== 404) throw err
    history = []
  }
  rankHistoryCache.set(puuid, history)
  return history
}

/** League rank for a tournament window: the highest held in it (see `peakRankBetween`). */
export async function fetchPeakRankBetween(
  puuid: string,
  start: Date,
  end: Date,
  opts: LookupOptions = {}
): Promise<string | null> {
  const history = await fetchStoredMmrHistory(puuid, opts)
  return toLeagueRank(peakRankBetween(history, start, end)?.name)
}

/** Account plus rank in one call, by Riot ID. */
export async function lookupPlayer(riotId: string, opts: LookupOptions = {}) {
  const { name, tag } = parseRiotId(riotId)
  const account = await fetchAccount(name, tag, opts)

  // A missing competitive record is not a failed lookup — the account is
  // still valid, there is just no rank to fill in.
  let rank: RiotRank | null = null
  try {
    rank = await fetchRank(account.name, account.tag, account.region, opts)
  } catch (err) {
    if (!(err instanceof RiotLookupError) || err.status !== 404) throw err
  }

  return { account, rank }
}

/**
 * Rank for a signup: by the player's linked PUUID when there is one, otherwise
 * by the Riot ID on the signup.
 */
export async function lookupSignupRank(
  target: { puuid: string | null; riotId: string | null },
  opts: LookupOptions = {}
): Promise<RankLookup> {
  if (target.puuid) return fetchRankByPuuid(target.puuid, opts)
  if (!target.riotId) {
    throw new RiotLookupError(400, 'This player has no linked Riot account or Riot ID.')
  }
  const { account, rank } = await lookupPlayer(target.riotId, opts)
  return { account: { name: account.name, tag: account.tag, puuid: account.puuid }, rank }
}
