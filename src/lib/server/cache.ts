type Entry<T> = {
  value: T
  /** Epoch ms after which the entry is stale. */
  expiresAt: number
}

type CacheOptions = {
  /** Time to live in milliseconds. */
  ttlMs: number
  /** Maximum entries retained; least-recently-used are evicted first. */
  maxEntries?: number
}

const DEFAULT_MAX_ENTRIES = 500

/**
 * In-memory TTL cache with LRU eviction.
 *
 * Scope is a single server process — a multi-instance deployment gets one
 * cache per instance, which is fine for read-through caching of public data
 * but means invalidation is best-effort rather than global.
 */
export class TtlCache<T> {
  #entries = new Map<string, Entry<T>>()
  #ttlMs: number
  #maxEntries: number

  constructor(options: CacheOptions) {
    this.#ttlMs = options.ttlMs
    this.#maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  }

  get(key: string): T | undefined {
    const entry = this.#entries.get(key)
    if (!entry) return undefined

    if (entry.expiresAt <= Date.now()) {
      this.#entries.delete(key)
      return undefined
    }

    // Re-insert so Map iteration order tracks recency for eviction.
    this.#entries.delete(key)
    this.#entries.set(key, entry)
    return entry.value
  }

  set(key: string, value: T): void {
    if (this.#entries.has(key)) this.#entries.delete(key)
    this.#entries.set(key, { value, expiresAt: Date.now() + this.#ttlMs })

    while (this.#entries.size > this.#maxEntries) {
      // Map preserves insertion order, so the first key is the least recent.
      const oldest = this.#entries.keys().next()
      if (oldest.done) break
      this.#entries.delete(oldest.value)
    }
  }

  delete(key: string): void {
    this.#entries.delete(key)
  }

  clear(): void {
    this.#entries.clear()
  }

  get size(): number {
    return this.#entries.size
  }

  /**
   * Read through the cache, computing and storing the value on a miss.
   *
   * Concurrent misses for the same key each run the loader; that is
   * acceptable here because the loaders are idempotent reads.
   */
  async wrap(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.get(key)
    if (hit !== undefined) return hit

    const value = await load()
    this.set(key, value)
    return value
  }
}

/**
 * Profile role lookup, hit on every authenticated request in hooks.server.ts.
 * Short TTL so a role change takes effect promptly without hammering the DB.
 */
export const profileRoleCache = new TtlCache<{ role: string } | null>({
  ttlMs: 30_000,
  maxEntries: 2000,
})

/** Public read-heavy page data: leaderboard, stats, events. */
export const publicDataCache = new TtlCache<unknown>({
  ttlMs: 60_000,
  maxEntries: 200,
})

/** Drop a cached profile role — call after any role or ban change. */
export function invalidateProfileRole(authSub: string | null | undefined) {
  if (authSub) profileRoleCache.delete(authSub)
}
