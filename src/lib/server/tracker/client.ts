import { execFile } from 'node:child_process'
import { TtlCache } from '$lib/server/cache'
import {
  findActById,
  parseActScore,
  parseHandle,
  parseSeasons,
  pickPeak,
  recomputeScore,
  type TrackerActScore,
  type TrackerSeason,
} from './parse'

/**
 * Reader for tracker.gg's internal profile API.
 *
 * Two things to understand before changing this:
 *
 * 1. This is an undocumented API behind Cloudflare. Node's `fetch` is refused
 *    with a 403 "You've Been Blocked" because of its TLS fingerprint, so the
 *    requests go through the `curl` binary instead. That means this only works
 *    on a host where curl exists — it will not run on most serverless
 *    platforms, and `isTrackerAvailable()` exists to say so clearly.
 *
 * 2. It is deliberately admin-triggered and cached hard. A peak lookup costs
 *    one request per act scanned, so unbounded use would hammer a third party
 *    that is actively discouraging automation.
 */

const BASE = 'https://api.tracker.gg/api/v2/valorant/standard/profile/riot'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36'

const HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://tracker.gg',
  Referer: 'https://tracker.gg/',
}

/** How many recent acts to scan for a peak. Each one is a request. */
const PEAK_ACT_LIMIT = 6

/** Scores move slowly, so cache for a long time. */
const lookupCache = new TtlCache<TrackerLookup>({ ttlMs: 6 * 60 * 60_000, maxEntries: 300 })

export class TrackerError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type TrackerLookup = {
  handle: string | null
  current: TrackerActScore | null
  peak: TrackerActScore | null
  /** How the peak reading was chosen. */
  peakSource: 'peak-rank-act' | 'highest-score' | null
  /** Acts inspected, newest first. */
  scanned: Array<{ act: string; score: number }>
  /**
   * Set when the reported score disagrees with the one recomputed from the
   * component percentiles — a sign the published weights have drifted.
   */
  verificationWarning: string | null
  /** Set when the peak act was requested but could not be used. */
  peakWarning: string | null
}

export type TrackerLookupOptions = {
  /**
   * Riot season UUID of the act the player peaked in. When supplied, the peak
   * tracker score is read from that act rather than being the highest score
   * across recent acts.
   */
  peakActId?: string | null
}

let curlChecked = false
let curlPresent = false

/** Whether this host can reach tracker.gg at all. */
export function isTrackerAvailable(): Promise<boolean> {
  if (curlChecked) return Promise.resolve(curlPresent)
  return new Promise((resolve) => {
    execFile('curl', ['--version'], { timeout: 5000 }, (err) => {
      curlChecked = true
      curlPresent = !err
      resolve(curlPresent)
    })
  })
}

function curlGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['-s', '-S', '--fail-with-body', '--compressed', '--max-time', '20']
    for (const [key, value] of Object.entries(HEADERS)) args.push('-H', `${key}: ${value}`)
    args.push(url)

    execFile('curl', args, { maxBuffer: 32 * 1024 * 1024, timeout: 25_000 }, (err, stdout) => {
      const body = String(stdout ?? '')
      if (err && !body) {
        return reject(new TrackerError(503, 'Could not reach tracker.gg from this server.'))
      }
      resolve(body)
    })
  })
}

/**
 * Backoff between retries of a blocked read. Observed 2026-08-14: Cloudflare
 * bot-checks only the requests that miss its cache and have to reach tracker's
 * origin, so a block is usually transient rather than a ban on the caller. The
 * same act URL returned the HTML block page, then 200 (`cf-cache-status:
 * EXPIRED`), then 200 (`HIT`) within a minute, from an unchanged host.
 *
 * This matters most for a peak-act reading: recent acts are warm in the cache
 * and almost always pass, while the old act a player peaked in is exactly the
 * cold request that gets challenged.
 */
const BLOCK_RETRY_BACKOFF_MS = [1_500, 4_000]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function getJson(path: string, attempt = 0): Promise<unknown> {
  const body = await curlGet(`${BASE}${path}`)

  // Cloudflare's block page is HTML, not JSON.
  if (/^\s*</.test(body)) {
    // Retry rather than fail: the read is very likely to succeed once the
    // origin has answered this URL once. Kept short so a host that really is
    // blocked still reports back quickly.
    if (attempt < BLOCK_RETRY_BACKOFF_MS.length) {
      await sleep(BLOCK_RETRY_BACKOFF_MS[attempt])
      return getJson(path, attempt + 1)
    }

    throw new TrackerError(
      403,
      'tracker.gg refused the request. It may be rate limiting or blocking this host.'
    )
  }

  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    throw new TrackerError(502, 'tracker.gg returned an unreadable response.')
  }

  const errors = (json as { errors?: unknown[] }).errors
  if (Array.isArray(errors) && errors.length > 0) {
    throw new TrackerError(404, 'No tracker.gg profile found for that Riot ID.')
  }

  return json
}

/**
 * Fetch the current and peak tracker score for a Riot ID.
 * `riotId` must be the full name#tag.
 */
export async function lookupTrackerScore(
  riotId: string,
  options: TrackerLookupOptions = {}
): Promise<TrackerLookup> {
  const trimmed = riotId.trim()
  if (!trimmed.includes('#')) {
    throw new TrackerError(400, 'Enter a full Riot ID in the form name#tag')
  }

  // The peak act is part of the result, so it belongs in the cache key.
  const cacheKey = `${trimmed.toLowerCase()}::${options.peakActId ?? 'auto'}`
  const cached = lookupCache.get(cacheKey)
  if (cached) return cached

  if (!(await isTrackerAvailable())) {
    throw new TrackerError(
      501,
      'Tracker lookups need the curl binary, which is not available on this host.'
    )
  }

  const encoded = encodeURIComponent(trimmed)
  const profile = await getJson(`/${encoded}`)
  const seasons = parseSeasons(profile)

  if (seasons.length === 0) {
    throw new TrackerError(404, 'That profile has no recorded acts on tracker.gg.')
  }

  /** Read one act, tolerating a missing segment but not a block. */
  const readAct = async (act: TrackerSeason): Promise<TrackerActScore | null> => {
    try {
      const segment = await getJson(
        `/${encoded}/segments/season?playlist=competitive&seasonId=${act.id}`
      )
      return parseActScore(segment, act)
    } catch (err) {
      // One act failing should not sink the lookup, but a block or an
      // unreachable host affects every act, so surface those.
      if (err instanceof TrackerError && (err.status === 403 || err.status === 503)) throw err
      return null
    }
  }

  // Current score always comes from the newest act with competitive play.
  let current: TrackerActScore | null = null
  const scanned: TrackerActScore[] = []
  for (const act of seasons.slice(0, PEAK_ACT_LIMIT)) {
    const parsed = await readAct(act)
    if (!parsed) continue
    scanned.push(parsed)
    if (!current) current = parsed
    // Only the newest act is needed unless a peak has to be inferred.
    if (options.peakActId) break
  }

  if (!current) {
    throw new TrackerError(404, 'No competitive tracker scores found for the recent acts.')
  }

  // Peak: prefer the act the player actually peaked in. Both services key
  // acts by Riot's season UUID, so this is an exact match rather than a
  // name-based guess.
  let peak: TrackerActScore | null = null
  let peakSource: TrackerLookup['peakSource'] = null
  let peakWarning: string | null = null

  if (options.peakActId) {
    const peakAct = findActById(seasons, options.peakActId)
    if (!peakAct) {
      peakWarning =
        'The act the player peaked in is not on their tracker.gg profile, so the highest recent score was used instead.'
    } else {
      const parsed = peakAct.id === current.actId ? current : ((await readAct(peakAct)) ?? null)
      if (parsed) {
        peak = parsed
        peakSource = 'peak-rank-act'
      } else {
        peakWarning = `tracker.gg has no competitive score for ${peakAct.shortName}, the act the player peaked in, so the highest recent score was used instead.`
      }
    }
  }

  if (!peak) {
    // Fall back to the best of the recent acts. When a peak act was requested
    // but unusable, the remaining acts have not been read yet.
    if (options.peakActId && scanned.length <= 1) {
      for (const act of seasons.slice(0, PEAK_ACT_LIMIT)) {
        if (scanned.some((s) => s.actId === act.id)) continue
        const parsed = await readAct(act)
        if (parsed) scanned.push(parsed)
      }
    }
    peak = pickPeak(scanned)
    peakSource = peak ? 'highest-score' : null
  }

  // Cross-check the newest reading against the component percentiles.
  let verificationWarning: string | null = null
  const recomputed = recomputeScore(current.components)
  if (recomputed != null && Math.abs(recomputed - current.score) > 2) {
    verificationWarning =
      `Reported score ${current.score} does not match ${recomputed} recomputed from its ` +
      `components — tracker.gg may have changed how the score is built. Verify before saving.`
  }

  const result: TrackerLookup = {
    handle: parseHandle(profile),
    current,
    peak,
    peakSource,
    scanned: scanned.map((s) => ({ act: s.actShortName, score: s.score })),
    verificationWarning,
    peakWarning,
  }

  lookupCache.set(cacheKey, result)
  return result
}
