import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TtlCache } from './cache'

describe('TtlCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns a stored value before it expires', () => {
    const cache = new TtlCache<number>({ ttlMs: 1000 })
    cache.set('a', 1)
    expect(cache.get('a')).toBe(1)
  })

  it('returns undefined for a missing key', () => {
    const cache = new TtlCache<number>({ ttlMs: 1000 })
    expect(cache.get('nope')).toBeUndefined()
  })

  it('expires entries once the ttl elapses', () => {
    const cache = new TtlCache<number>({ ttlMs: 1000 })
    cache.set('a', 1)

    vi.advanceTimersByTime(999)
    expect(cache.get('a')).toBe(1)

    vi.advanceTimersByTime(2)
    expect(cache.get('a')).toBeUndefined()
  })

  it('drops the expired entry rather than leaking it', () => {
    const cache = new TtlCache<number>({ ttlMs: 1000 })
    cache.set('a', 1)
    vi.advanceTimersByTime(1001)

    cache.get('a')
    expect(cache.size).toBe(0)
  })

  it('evicts the least recently used entry past maxEntries', () => {
    const cache = new TtlCache<number>({ ttlMs: 10_000, maxEntries: 2 })
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)

    expect(cache.size).toBe(2)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
  })

  it('counts a read as recent use for eviction ordering', () => {
    const cache = new TtlCache<number>({ ttlMs: 10_000, maxEntries: 2 })
    cache.set('a', 1)
    cache.set('b', 2)

    // Touch 'a' so 'b' becomes the least recently used.
    cache.get('a')
    cache.set('c', 3)

    expect(cache.get('a')).toBe(1)
    expect(cache.get('b')).toBeUndefined()
  })

  it('overwrites an existing key without growing', () => {
    const cache = new TtlCache<number>({ ttlMs: 1000 })
    cache.set('a', 1)
    cache.set('a', 2)

    expect(cache.size).toBe(1)
    expect(cache.get('a')).toBe(2)
  })

  it('resets the ttl when a key is overwritten', () => {
    const cache = new TtlCache<number>({ ttlMs: 1000 })
    cache.set('a', 1)

    vi.advanceTimersByTime(900)
    cache.set('a', 2)

    vi.advanceTimersByTime(900)
    expect(cache.get('a')).toBe(2)
  })

  it('deletes and clears', () => {
    const cache = new TtlCache<number>({ ttlMs: 1000 })
    cache.set('a', 1)
    cache.set('b', 2)

    cache.delete('a')
    expect(cache.get('a')).toBeUndefined()
    expect(cache.size).toBe(1)

    cache.clear()
    expect(cache.size).toBe(0)
  })

  describe('wrap', () => {
    it('runs the loader on a miss and caches the result', async () => {
      const cache = new TtlCache<number>({ ttlMs: 1000 })
      const load = vi.fn().mockResolvedValue(42)

      expect(await cache.wrap('a', load)).toBe(42)
      expect(await cache.wrap('a', load)).toBe(42)
      expect(load).toHaveBeenCalledTimes(1)
    })

    it('runs the loader again once the entry expires', async () => {
      const cache = new TtlCache<number>({ ttlMs: 1000 })
      const load = vi.fn().mockResolvedValue(42)

      await cache.wrap('a', load)
      vi.advanceTimersByTime(1001)
      await cache.wrap('a', load)

      expect(load).toHaveBeenCalledTimes(2)
    })

    it('does not cache a rejected loader', async () => {
      const cache = new TtlCache<number>({ ttlMs: 1000 })
      const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(7)

      await expect(cache.wrap('a', load)).rejects.toThrow('boom')
      expect(cache.size).toBe(0)
      expect(await cache.wrap('a', load)).toBe(7)
    })
  })
})
