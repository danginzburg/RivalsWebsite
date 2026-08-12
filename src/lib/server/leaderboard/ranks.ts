import { supabaseAdmin } from '$lib/supabase/admin'
import { TtlCache } from '$lib/server/cache'

/**
 * Standings position, keyed by team id.
 *
 * This is the team's rank in the full leaderboard — every team in the season,
 * not just the eight that made the bracket. Playoff seeding lives in
 * `$lib/server/seasons/seeds` and belongs only to bracket surfaces; anywhere a
 * team appears in league context (the match feed, a match page) the number
 * people expect is where that team sits in the standings.
 */
export type RankMap = Record<string, number>

/** Ranks change on each leaderboard import, not on each page view. */
const rankCache = new TtlCache<RankMap>({ ttlMs: 5 * 60_000, maxEntries: 50 })

type EntryRow = { team_id: string; rank: number | null }

function toRankMap(rows: EntryRow[] | null | undefined): RankMap {
  const map: RankMap = {}
  for (const row of rows ?? []) {
    const rank = Number(row.rank)
    if (row.team_id && Number.isFinite(rank) && rank > 0) map[row.team_id] = rank
  }
  return map
}

/**
 * A leaderboard import replaces every row for its season, so a season has one
 * current set of entries and there is no batch to disambiguate.
 */
async function fetchSeasonRanks(seasonId: string | null): Promise<RankMap> {
  const query = supabaseAdmin.from('leaderboard_entries').select('team_id, rank')

  const { data } = seasonId
    ? await query.eq('season_id', seasonId)
    : await query.is('season_id', null)

  return toRankMap(data as EntryRow[] | null)
}

/** Standings ranks for one season. Empty when that season has no import. */
export async function getSeasonStandingsRanks(
  seasonId: string | null | undefined
): Promise<RankMap> {
  const key = seasonId ?? '__none__'
  return rankCache.wrap(key, () => fetchSeasonRanks(seasonId ?? null))
}

/**
 * Ranks across several seasons merged into one map.
 *
 * A team belongs to a single season, so ids do not collide — this lets a mixed
 * list such as the match feed resolve every team in one lookup.
 */
export async function getStandingsRanksForSeasons(
  seasonIds: Array<string | null | undefined>
): Promise<RankMap> {
  // A null season is a real bucket here: matches not tied to a season read the
  // entries that were imported without one.
  const keys = Array.from(new Set(seasonIds.map((id) => id ?? null)))
  if (keys.length === 0) return {}

  const maps = await Promise.all(keys.map((id) => getSeasonStandingsRanks(id)))
  return Object.assign({}, ...maps) as RankMap
}

/** Drop cached ranks after a leaderboard import. */
export function invalidateStandingsRanks(seasonId?: string | null) {
  rankCache.delete(seasonId ?? '__none__')
}
