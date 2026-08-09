import { error } from '@sveltejs/kit'

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

/**
 * Sliding-window rate limit, in memory and per process.
 *
 * This is a guard against accidental hammering and casual abuse, not a
 * distributed rate limiter — a multi-instance deployment would need shared
 * state (Redis or similar) to enforce a global budget.
 *
 * Throws a 429 when the caller is over budget.
 */
export function enforceRateLimit(
  key: string,
  options: { limit: number; windowMs: number; message?: string }
) {
  const now = Date.now()
  sweep(now)

  const bucket = buckets.get(key) ?? { hits: [] }
  const cutoff = now - options.windowMs
  const hits = bucket.hits.filter((t) => t > cutoff)

  if (hits.length >= options.limit) {
    const retryAfter = Math.ceil((hits[0] + options.windowMs - now) / 1000)
    throw error(
      429,
      options.message ?? `Too many requests. Try again in ${Math.max(retryAfter, 1)}s.`
    )
  }

  hits.push(now)
  buckets.set(key, { hits })
}

/** Reset all buckets. Test helper. */
export function __resetRateLimits() {
  buckets.clear()
  lastSweep = Date.now()
}
