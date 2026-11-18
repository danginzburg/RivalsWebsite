import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('$lib/supabase/admin', () => ({
  supabaseAdmin: { rpc: (...args: unknown[]) => rpc(...args) },
}))

import { enforceLocalRateLimit, enforceRateLimit, __resetRateLimits } from './rate-limit'

describe('enforceLocalRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetRateLimits()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows requests up to the limit', () => {
    for (let i = 0; i < 5; i++) {
      expect(() => enforceLocalRateLimit('user-1', { limit: 5, windowMs: 1000 })).not.toThrow()
    }
  })

  it('throws once the limit is exceeded', () => {
    for (let i = 0; i < 5; i++) {
      enforceLocalRateLimit('user-1', { limit: 5, windowMs: 1000 })
    }

    expect(() => enforceLocalRateLimit('user-1', { limit: 5, windowMs: 1000 })).toThrow()
  })

  it('rejects with a 429', () => {
    enforceLocalRateLimit('user-1', { limit: 1, windowMs: 1000 })

    try {
      enforceLocalRateLimit('user-1', { limit: 1, windowMs: 1000 })
      throw new Error('expected a rate limit rejection')
    } catch (err) {
      expect((err as { status?: number }).status).toBe(429)
    }
  })

  it('tracks each key independently', () => {
    enforceLocalRateLimit('user-1', { limit: 1, windowMs: 1000 })

    expect(() => enforceLocalRateLimit('user-2', { limit: 1, windowMs: 1000 })).not.toThrow()
  })

  it('lets requests through again once the window slides past', () => {
    enforceLocalRateLimit('user-1', { limit: 1, windowMs: 1000 })
    expect(() => enforceLocalRateLimit('user-1', { limit: 1, windowMs: 1000 })).toThrow()

    vi.advanceTimersByTime(1001)
    expect(() => enforceLocalRateLimit('user-1', { limit: 1, windowMs: 1000 })).not.toThrow()
  })

  it('slides rather than resetting in fixed blocks', () => {
    // Two hits at t=0, limit of 3 in a 1000ms window.
    enforceLocalRateLimit('user-1', { limit: 3, windowMs: 1000 })
    enforceLocalRateLimit('user-1', { limit: 3, windowMs: 1000 })

    vi.advanceTimersByTime(600)
    enforceLocalRateLimit('user-1', { limit: 3, windowMs: 1000 })
    // Budget is spent: three hits are still inside the window.
    expect(() => enforceLocalRateLimit('user-1', { limit: 3, windowMs: 1000 })).toThrow()

    // At t=1001 the first two have aged out, leaving room for one more.
    vi.advanceTimersByTime(401)
    expect(() => enforceLocalRateLimit('user-1', { limit: 3, windowMs: 1000 })).not.toThrow()
  })

  it('includes a retry hint in the message', () => {
    enforceLocalRateLimit('user-1', { limit: 1, windowMs: 5000 })

    try {
      enforceLocalRateLimit('user-1', { limit: 1, windowMs: 5000 })
      throw new Error('expected a rate limit rejection')
    } catch (err) {
      const body = (err as { body?: { message?: string } }).body
      expect(body?.message).toMatch(/try again/i)
    }
  })

  it('uses a custom message when provided', () => {
    enforceLocalRateLimit('user-1', { limit: 1, windowMs: 1000, message: 'Slow down.' })

    try {
      enforceLocalRateLimit('user-1', { limit: 1, windowMs: 1000, message: 'Slow down.' })
      throw new Error('expected a rate limit rejection')
    } catch (err) {
      const body = (err as { body?: { message?: string } }).body
      expect(body?.message).toBe('Slow down.')
    }
  })
})

describe('enforceRateLimit (shared)', () => {
  beforeEach(() => {
    rpc.mockReset()
    __resetRateLimits()
  })

  it('passes the key and budget to Postgres and allows a 0 result', async () => {
    rpc.mockResolvedValue({ data: 0, error: null })
    await expect(enforceRateLimit('k', { limit: 3, windowMs: 60_000 })).resolves.toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('consume_rate_limit', {
      p_key: 'k',
      p_limit: 3,
      p_window_ms: 60_000,
    })
  })

  it('rejects with a 429 and the wait when Postgres says the window is full', async () => {
    rpc.mockResolvedValue({ data: 12_400, error: null })
    await expect(enforceRateLimit('k', { limit: 3, windowMs: 60_000 })).rejects.toMatchObject({
      status: 429,
      body: { message: 'Too many requests. Try again in 13s.' },
    })
  })

  it('falls back to the in-memory limiter when the database call fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'down' } })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await enforceRateLimit('k', { limit: 1, windowMs: 60_000 })
    await expect(enforceRateLimit('k', { limit: 1, windowMs: 60_000 })).rejects.toMatchObject({
      status: 429,
    })
  })
})
