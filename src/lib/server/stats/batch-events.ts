import { eventLabelFromBatchName, resolveBatchSection } from '$lib/stats/sections'
import { resolveSeasonStatBatchIds, toFullSeasonBatchId } from './season-batches'

type SeasonRow = {
  id: string
  code?: string | null
  name?: string | null
  kind?: string | null
  metadata?: { stat_batches?: unknown } | null
}

type BatchMetaRow = {
  id: string
  metadata?: unknown
}

export type BatchEvent = { name: string; external: boolean }

/**
 * Files each batch under the event the stats picker shows it in, and orders
 * those events. A season's curated batches take the season's name; anything
 * else (combined postseason files, other regions, side leagues) is read from
 * its own name and folded into a season when the two names agree.
 *
 * `seasons` must already be newest first — that is the event order.
 * `batchRows` are the raw DB rows, for the source season a generated batch
 * records in its metadata.
 */
export function groupBatchesByEvent<B extends { id: string; display_name?: string | null }>(
  batches: B[],
  seasons: SeasonRow[],
  batchRows: BatchMetaRow[]
): { batches: Array<B & { event: string }>; events: BatchEvent[] } {
  const tidy = (s: string) => s.replace(/\s+/g, ' ').trim()
  const seasonOrderByName = new Map<string, number>()
  const seasonNameByBatch = new Map<string, string>()
  const seasonNameById = new Map<string, string>()
  const externalSeasonNames = new Set<string>()
  seasons.forEach((s, index) => {
    const name = tidy(s.name ?? '')
    if (!name) return
    seasonOrderByName.set(name.toLowerCase(), index)
    seasonNameById.set(s.id, name)
    if (s.kind === 'external') externalSeasonNames.add(name.toLowerCase())
    if (s.code) seasonNameByBatch.set(toFullSeasonBatchId(s.code), name)
    for (const id of resolveSeasonStatBatchIds(s)) seasonNameByBatch.set(id, name)
  })

  // Batches generated from imported matches record the season they came from,
  // which is the only reliable way to tell an external event's batch apart —
  // CSV-era batches carry nothing and are always rivals.
  for (const row of batchRows) {
    const sourceSeasonId = (row.metadata as { source_season_id?: string | null } | null)
      ?.source_season_id
    const name = sourceSeasonId ? seasonNameById.get(sourceSeasonId) : undefined
    if (name && !seasonNameByBatch.has(row.id)) seasonNameByBatch.set(row.id, name)
  }

  const grouped = batches.map((b) => ({
    ...b,
    event: seasonNameByBatch.get(b.id) ?? tidy(eventLabelFromBatchName(b.display_name)),
  }))

  // Seasons newest first; "Season 2 (EMEA)" sits right after "Season 2"; All
  // Time and anything unmatched go last, in the order they were listed.
  const eventRank = (event: string) => {
    if (resolveBatchSection({ display_name: event }) === 'alltime') return Number.MAX_SAFE_INTEGER
    const key = event.toLowerCase()
    const exact = seasonOrderByName.get(key)
    if (exact !== undefined) return exact * 2
    const base = seasonOrderByName.get(key.replace(/\s*\([^)]*\)$/, ''))
    if (base !== undefined) return base * 2 + 1
    return Number.MAX_SAFE_INTEGER - 1
  }
  const firstSeen = new Map<string, number>()
  grouped.forEach((b, i) => {
    if (!firstSeen.has(b.event)) firstSeen.set(b.event, i)
  })
  const events = [...firstSeen.keys()]
    .sort((a, z) => eventRank(a) - eventRank(z) || firstSeen.get(a)! - firstSeen.get(z)!)
    .map((name) => ({ name, external: externalSeasonNames.has(name.toLowerCase()) }))

  return { batches: grouped, events }
}
