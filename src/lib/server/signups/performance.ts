import { supabaseAdmin } from '$lib/supabase/admin'
import { fetchAllRows } from '$lib/server/supabase/fetch-all'
import { loadPlayerDirectory } from '$lib/server/players/directory'
import { resolveSeasonStatBatchIds } from '$lib/server/stats/season-batches'
import { aggregateFullSeasonRows } from '$lib/server/stats/aggregate-full-season'
import {
  buildPerformanceModel,
  performanceFor,
  type MapStatRow,
  type PerformanceModel,
  type PerformanceResult,
  type SeasonInput,
  type SeasonStatRow,
} from './performance-model'

/**
 * League performance for signup scores, from the site's own stats: see
 * `./performance-model` for the method.
 */

/**
 * The seasons the bonus is built from, oldest first, and how much each counts.
 * Season 4 is the most recent, so it counts double. Add each finished season
 * here (and drop the oldest) when a new one's signups open.
 */
export const PERFORMANCE_SEASONS = [
  { code: 'rivals3', weight: 0.5 },
  { code: 'rivals4', weight: 1 },
] as const

/** Past seasons' stats do not change, so the model is rebuilt at most this often. */
const CACHE_MS = 10 * 60_000

let cache: { at: number; model: Promise<PerformanceModel> } | null = null

/** The model, built once and reused until the cache runs out. */
function loadPerformanceModel(): Promise<PerformanceModel> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.model
  const model = buildFromDatabase()
  cache = { at: Date.now(), model }
  // A failed build must not stay cached.
  model.catch(() => {
    if (cache?.model === model) cache = null
  })
  return model
}

async function buildFromDatabase(): Promise<PerformanceModel> {
  const { data: seasonRows, error } = await supabaseAdmin
    .from('seasons')
    .select('id, code, metadata')
    .in(
      'code',
      PERFORMANCE_SEASONS.map((s) => s.code)
    )
  if (error) throw new Error(`Failed to load seasons: ${error.message}`)
  const seasonByCode = new Map((seasonRows ?? []).map((s) => [s.code as string, s]))

  const [inputs, fallbackRanks] = await Promise.all([
    Promise.all(
      PERFORMANCE_SEASONS.map(async ({ code, weight }): Promise<SeasonInput> => {
        const season = seasonByCode.get(code) ?? null
        const batchIds = resolveSeasonStatBatchIds(season ?? { code })
        const [rows, mapRows] = await Promise.all([
          loadSeasonRows(batchIds, code),
          season ? loadMapRows(season.id as string) : Promise.resolve([]),
        ])
        return { code, weight, rows, mapRows }
      })
    ),
    loadSignupRanks(),
  ])

  return buildPerformanceModel(inputs, fallbackRanks)
}

async function loadSeasonRows(batchIds: string[], code: string): Promise<SeasonStatRow[]> {
  if (batchIds.length === 0) return []
  const rows = await fetchAllRows<Record<string, unknown>>(() =>
    supabaseAdmin.from('rivals_group_stats').select('*').in('import_batch_id', batchIds).order('id')
  )
  return aggregateFullSeasonRows(rows, `season:${code}`) as unknown as SeasonStatRow[]
}

/** Per-map rows played by the season's teams, for opponent strength. */
async function loadMapRows(seasonId: string): Promise<MapStatRow[]> {
  const { data: teams, error } = await supabaseAdmin
    .from('teams')
    .select('id')
    .eq('season_id', seasonId)
  if (error) throw new Error(`Failed to load teams: ${error.message}`)
  const teamIds = (teams ?? []).map((t) => t.id as string)
  const rows: MapStatRow[] = []
  for (let i = 0; i < teamIds.length; i += 100) {
    const chunk = teamIds.slice(i, i + 100)
    rows.push(
      ...(await fetchAllRows<MapStatRow>(() =>
        supabaseAdmin
          .from('player_match_map_stats')
          .select('match_map_id, team_id, profile_id, player_name, rounds')
          .in('team_id', chunk)
          .order('id')
      ))
    )
  }
  return rows
}

/** Each player's latest signup rank, the last resort for a season with no rank on record. */
async function loadSignupRanks(): Promise<Map<string, string | null>> {
  const rows = await fetchAllRows<{ profile_id: string; current_rank: string | null }>(() =>
    supabaseAdmin
      .from('player_signups')
      .select('profile_id, current_rank, created_at')
      .order('created_at', { ascending: true })
      .order('id')
  )
  const ranks = new Map<string, string | null>()
  for (const row of rows) if (row.current_rank) ranks.set(row.profile_id, row.current_rank)
  return ranks
}

/** Performance for the given players, keyed by profile id; players without league stats are absent. */
export async function loadPerformanceForPlayers(
  profileIds: string[]
): Promise<Map<string, PerformanceResult>> {
  const ids = [...new Set(profileIds.filter(Boolean))]
  const found = new Map<string, PerformanceResult>()
  if (ids.length === 0) return found

  const [model, directory] = await Promise.all([loadPerformanceModel(), loadPlayerDirectory(ids)])
  for (const profileId of ids) {
    const entry = directory.get(profileId)
    const result = performanceFor(model, {
      profileId,
      names: [entry?.riot_name, ...(entry?.riot_ids ?? [])],
    })
    if (result) found.set(profileId, result)
  }
  return found
}

export async function loadPerformanceFor(profileId: string): Promise<PerformanceResult | null> {
  return (await loadPerformanceForPlayers([profileId])).get(profileId) ?? null
}
