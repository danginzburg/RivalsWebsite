import { error } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'

type Bucket = {
  /** Timestamps of requests still inside the window. */
  hits: number[]
}

const buckets = new Map<string, Bucket>()

/** Drop buckets that have been idle for a while so the map does not grow forever. */
let lastSweep = Date.now()
const SWEEP_INTERVAL_MS = 5 * 60 * 1000

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return
  lastSweep = now
  for (const [key, bucket] of buckets) {
    if (bucket.hits.length === 0 || now - bucket.hits[bucket.hits.length - 1] > SWEEP_INTERVAL_MS) {
      buckets.delete(key)
    }
  }
}

type RateLimitOptions = { limit: number; windowMs: number; message?: string }

function tooMany(options: RateLimitOptions, retryAfterMs: number): never {
  const retryAfter = Math.max(Math.ceil(retryAfterMs / 1000), 1)
  throw error(429, options.message ?? `Too many requests. Try again in ${retryAfter}s.`)
}

/**
 * Sliding-window rate limit, in memory and per process.
 *
 * On Vercel each serverless instance has its own memory, so this only counts
 * the requests one instance saw. It is the cheap blanket ceiling for the whole
 * API (no database round trip per request); per-user action limits use
 * `enforceRateLimit`, which is shared across instances.
 *
 * Throws a 429 when the caller is over budget.
 */
export function enforceLocalRateLimit(key: string, options: RateLimitOptions) {
  const now = Date.now()
  sweep(now)

  const bucket = buckets.get(key) ?? { hits: [] }
  const cutoff = now - options.windowMs
  const hits = bucket.hits.filter((t) => t > cutoff)

  if (hits.length >= options.limit) tooMany(options, hits[0] + options.windowMs - now)

  hits.push(now)
  buckets.set(key, { hits })
}

/**
 * Rate limit shared by every server instance, counted in Postgres
 * (`consume_rate_limit`). Use it for per-user actions: posting, reporting,
 * Riot lookups, imports.
 *
 * If the database call itself fails, this falls back to the in-memory limiter
 * rather than letting the request through unchecked or failing it outright.
 *
 * Throws a 429 when the caller is over budget.
 */
export async function enforceRateLimit(key: string, options: RateLimitOptions): Promise<void> {
  const { data, error: rpcError } = await supabaseAdmin.rpc('consume_rate_limit', {
    p_key: key,
    p_limit: options.limit,
    p_window_ms: options.windowMs,
  })
  if (rpcError || typeof data !== 'number') {
    console.warn('Shared rate limit unavailable, using the in-memory one:', rpcError?.message)
    enforceLocalRateLimit(key, options)
    return
  }
  if (data > 0) tooMany(options, data)
}

/** Reset all buckets. Test helper. */
export function __resetRateLimits() {
  buckets.clear()
  lastSweep = Date.now()
}
