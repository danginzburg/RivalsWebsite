/**
 * Client-side pacing for the HenrikDev API, kept apart from the transport so it
 * can be tested with a fake clock.
 *
 * One limiter is shared by every caller in the process (single lookups, the
 * bulk rank fill, match import) because they all spend the same key's budget.
 *
 * Requests are spaced evenly rather than allowed to burst. The key's limit is
 * per minute, and a burst would leave a long bulk run stalled for most of a
 * minute — longer than one request's time budget. The server's own rate-limit
 * headers are honoured on top of that, which covers what this process cannot
 * see: other server instances and other users of the same key.
 */

/** Spacing headroom over the exact limit, for clock drift and network jitter. */
const SPACING_HEADROOM = 1.1

/** How long to back off after a 429 that gives no hint. */
const DEFAULT_BACKOFF_MS = 60_000

export class RateLimitWaitError extends Error {
  /** How long the caller would have had to wait for a slot. */
  waitMs: number
  constructor(waitMs: number) {
    super('Rate limit wait exceeds the allowed time')
    this.waitMs = waitMs
  }
}

export type RateLimiterOptions = {
  /** Requests per minute until the server reports its own limit. */
  limitPerMinute: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

function headerNumber(headers: Headers, name: string): number | null {
  const raw = headers.get(name)
  if (raw == null || raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export class RateLimiter {
  private limitPerMinute: number
  private nextSlotAt = 0
  private blockedUntil = 0
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(options: RateLimiterOptions) {
    this.limitPerMinute = Math.max(1, options.limitPerMinute)
    this.now = options.now ?? (() => Date.now())
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  get intervalMs(): number {
    return Math.ceil((60_000 / this.limitPerMinute) * SPACING_HEADROOM)
  }

  /** Time until a request could be sent, ignoring slots already reserved. */
  get blockedForMs(): number {
    return Math.max(0, this.blockedUntil - this.now())
  }

  /**
   * Wait for a request slot. Throws RateLimitWaitError instead of waiting past
   * `maxWaitMs`, so a caller with a deadline can stop cleanly rather than
   * overrun it.
   */
  async acquire(maxWaitMs = Infinity): Promise<void> {
    const deadline = this.now() + maxWaitMs

    // Loop because a 429 seen by another caller while this one slept moves the
    // block further out.
    for (;;) {
      const now = this.now()
      const slot = Math.max(now, this.nextSlotAt, this.blockedUntil)
      if (slot > deadline) throw new RateLimitWaitError(slot - now)

      // Reserve synchronously so concurrent callers queue behind one another.
      this.nextSlotAt = slot + this.intervalMs
      if (slot > now) await this.sleep(slot - now)
      if (this.blockedUntil <= this.now()) return
    }
  }

  /** Learn from a response: the key's real limit, and any block it reports. */
  observe(headers: Headers, status: number): void {
    const limit = headerNumber(headers, 'x-ratelimit-limit')
    if (limit != null && limit > 0) this.limitPerMinute = limit

    const now = this.now()
    const resetMs = this.resetMs(headers)

    if (status === 429) {
      const retryAfter = headerNumber(headers, 'retry-after')
      const backoff = retryAfter != null ? retryAfter * 1000 : (resetMs ?? DEFAULT_BACKOFF_MS)
      this.block(now + Math.max(backoff, 1000))
      return
    }

    const remaining = headerNumber(headers, 'x-ratelimit-remaining')
    if (remaining != null && remaining <= 0 && resetMs != null) this.block(now + resetMs)
  }

  /** Milliseconds until the window resets; accepts seconds or an epoch time. */
  private resetMs(headers: Headers): number | null {
    const reset = headerNumber(headers, 'x-ratelimit-reset')
    if (reset == null || reset < 0) return null
    // Large values are an epoch timestamp (seconds) rather than a duration.
    if (reset > 1e9) return Math.max(0, reset * 1000 - this.now())
    return reset * 1000
  }

  private block(until: number) {
    this.blockedUntil = Math.max(this.blockedUntil, until)
  }
}
