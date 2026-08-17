import { supabaseAdmin } from '$lib/supabase/admin'
import { TtlCache } from '$lib/server/cache'
import { normalizePickemSeeds } from '$lib/pickems'

/**
 * Playoff seeds, keyed by team id.
 *
 * Seeds live on the season's pick'em event (`pickem_events.config.seeds`), so
 * this is the one place that knows how to read them. Every surface that shows a
 * team goes through here rather than reaching into the pick'em config itself.
 */
export type SeedMap = Record<string, number>

/** Seeds change only when an admin edits the bracket. */
const seedCache = new TtlCache<SeedMap>({ ttlMs: 5 * 60_000, maxEntries: 50 })

function toSeedMap(config: unknown): SeedMap {
  const raw = config && typeof config === 'object' ? (config as Record<string, unknown>) : {}
  const map: SeedMap = {}
  for (const entry of normalizePickemSeeds(raw.seeds)) {
    if (entry.teamId) map[entry.teamId] = entry.seed
  }
  return map
}

/** Seeds for one season. Empty when the season has no bracket configured. */
export async function getSeasonSeeds(seasonId: string | null | undefined): Promise<SeedMap> {
  if (!seasonId) return {}

  return seedCache.wrap(seasonId, async () => {
    const { data } = await supabaseAdmin
      .from('pickem_events')
      .select('config')
      .eq('season_id', seasonId)
      .maybeSingle()

    return toSeedMap(data?.config)
  })
}

/**
 * Seeds for the active season — the common case for pages that are not
 * scoped to a specific season.
 */
export async function getActiveSeasonSeeds(): Promise<SeedMap> {
  return seedCache.wrap('__active__', async () => {
    const { data } = await supabaseAdmin
      .from('pickem_events')
      .select('config, seasons!inner (is_active)')
      .eq('seasons.is_active', true)
      .maybeSingle()

    return toSeedMap(data?.config)
  })
}

/**
 * Seeds across several seasons merged into one map.
 *
 * A team belongs to a single season, so ids do not collide — this lets a
 * mixed list (such as the match feed) resolve every team in one lookup.
 */
export async function getSeedsForSeasons(
  seasonIds: Array<string | null | undefined>
): Promise<SeedMap> {
  const ids = Array.from(new Set(seasonIds.filter((id): id is string => Boolean(id))))
  if (ids.length === 0) return {}

  const maps = await Promise.all(ids.map((id) => getSeasonSeeds(id)))
  return Object.assign({}, ...maps) as SeedMap
}

/** Drop cached seeds after a bracket edit. */
export function invalidateSeasonSeeds(seasonId?: string | null) {
  if (seasonId) seedCache.delete(seasonId)
  seedCache.delete('__active__')
}
