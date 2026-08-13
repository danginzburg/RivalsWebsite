import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { enforceRateLimit, __resetRateLimits } from './rate-limit'

describe('enforceRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetRateLimits()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows requests up to the limit', () => {
    for (let i = 0; i < 5; i++) {
      expect(() => enforceRateLimit('user-1', { limit: 5, windowMs: 1000 })).not.toThrow()
    }
  })

  it('throws once the limit is exceeded', () => {
    for (let i = 0; i < 5; i++) {
      enforceRateLimit('user-1', { limit: 5, windowMs: 1000 })
    }

    expect(() => enforceRateLimit('user-1', { limit: 5, windowMs: 1000 })).toThrow()
  })

  it('rejects with a 429', () => {
    enforceRateLimit('user-1', { limit: 1, windowMs: 1000 })

    try {
      enforceRateLimit('user-1', { limit: 1, windowMs: 1000 })
      throw new Error('expected a rate limit rejection')
    } catch (err) {
      expect((err as { status?: number }).status).toBe(429)
    }
  })

  it('tracks each key independently', () => {
    enforceRateLimit('user-1', { limit: 1, windowMs: 1000 })

    expect(() => enforceRateLimit('user-2', { limit: 1, windowMs: 1000 })).not.toThrow()
  })

  it('lets requests through again once the window slides past', () => {
    enforceRateLimit('user-1', { limit: 1, windowMs: 1000 })
    expect(() => enforceRateLimit('user-1', { limit: 1, windowMs: 1000 })).toThrow()

    vi.advanceTimersByTime(1001)
    expect(() => enforceRateLimit('user-1', { limit: 1, windowMs: 1000 })).not.toThrow()
  })

  it('slides rather than resetting in fixed blocks', () => {
    // Two hits at t=0, limit of 3 in a 1000ms window.
    enforceRateLimit('user-1', { limit: 3, windowMs: 1000 })
    enforceRateLimit('user-1', { limit: 3, windowMs: 1000 })

    vi.advanceTimersByTime(600)
    enforceRateLimit('user-1', { limit: 3, windowMs: 1000 })
    // Budget is spent: three hits are still inside the window.
    expect(() => enforceRateLimit('user-1', { limit: 3, windowMs: 1000 })).toThrow()

    // At t=1001 the first two have aged out, leaving room for one more.
    vi.advanceTimersByTime(401)
    expect(() => enforceRateLimit('user-1', { limit: 3, windowMs: 1000 })).not.toThrow()
  })

  it('includes a retry hint in the message', () => {
    enforceRateLimit('user-1', { limit: 1, windowMs: 5000 })

    try {
      enforceRateLimit('user-1', { limit: 1, windowMs: 5000 })
      throw new Error('expected a rate limit rejection')
    } catch (err) {
      const body = (err as { body?: { message?: string } }).body
      expect(body?.message).toMatch(/try again/i)
    }
  })

  it('uses a custom message when provided', () => {
    enforceRateLimit('user-1', { limit: 1, windowMs: 1000, message: 'Slow down.' })

    try {
      enforceRateLimit('user-1', { limit: 1, windowMs: 1000, message: 'Slow down.' })
      throw new Error('expected a rate limit rejection')
    } catch (err) {
      const body = (err as { body?: { message?: string } }).body
      expect(body?.message).toBe('Slow down.')
    }
  })
})
