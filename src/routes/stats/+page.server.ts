import type { PageServerLoad } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'
import { safeInt } from '$lib/server/parse'
import { loadIdentityDisplayNames } from '$lib/server/players/riot-identities'
import {
  normalizeRivalsGroupStatBatchFromDb,
  withSectionFallback,
  type NormalizedRivalsGroupStatBatch,
  type StatImportBatchRow,
} from '$lib/server/stats/rivals-batch'
import { resolveSeasonStatBatchIds, toFullSeasonBatchId } from '$lib/server/stats/season-batches'
import { eventLabelFromBatchName, isWeekBatch, resolveBatchSection } from '$lib/stats/sections'

function normalizeSort(value: string | null): string {
  const v = String(value ?? '')
    .trim()
    .toLowerCase()
  const allowed = new Set([
    'player_name',
    'agents',
    'games',
    'games_won',
    'games_lost',
    'win_pct',
    'rounds',
    'rounds_won',
    'rounds_lost',
    'round_win_pct',
    'acs',
    'kd',
    'kast_pct',
    'adr',
    'kills',
    'deaths',
    'assists',
    'kpg',
    'kpr',
    'dpg',
    'dpr',
    'apg',
    'apr',
    'fk',
    'fd',
    'fkpg',
    'fdpg',
    'hs_pct',
    'plants',
    'plants_per_game',
    'defuses',
    'defuses_per_game',
    'league_rank',
    'mk_2k',
    'mk_3k',
    'mk_4k',
    'mk_5k',
    'mk_6k',
    'mk_7k',
    'clutches_won',
    'clutches_attempted',
    'slr',
  ])
  return allowed.has(v) ? v : 'acs'
}

function normalizeDir(value: string | null, sort: string): 'asc' | 'desc' {
  const v = String(value ?? '')
    .trim()
    .toLowerCase()
  if (v === 'asc' || v === 'desc') return v
  return sort === 'player_name' ? 'asc' : 'desc'
}

// Remembers the last stats table a visitor picked, so /stats with no batchId
// reopens it instead of falling back to the default batch.
const LAST_BATCH_COOKIE = 'stats_last_batch'
const LAST_BATCH_MAX_AGE = 60 * 60 * 24 * 365

export const load: PageServerLoad = async ({ fetch, url, locals, cookies }) => {
  const urlBatchId = url.searchParams.get('batchId')
  const rememberedBatchId = urlBatchId ? null : (cookies.get(LAST_BATCH_COOKIE) ?? null)
  const initialQ = String(url.searchParams.get('q') ?? '')
  const initialMinGames = Math.max(0, safeInt(url.searchParams.get('minGames'), 0))
  const initialSort = normalizeSort(url.searchParams.get('sort'))
  const initialDir = normalizeDir(url.searchParams.get('dir'), initialSort)
  // Toggles ride in the URL because changing batch is a full navigation,
  // which would otherwise reset them.
  const initialRankSort = url.searchParams.get('rankSort') === '1'
  const initialDisregardTier = url.searchParams.get('ignoreTier') === '1'

  const fetchStats = async (batchId: string | null) => {
    const res = await fetch(
      `/api/stats?limit=500${batchId ? `&batchId=${encodeURIComponent(batchId)}` : ''}`
    )
    return res.json().catch(() => ({}))
  }

  let body = await fetchStats(urlBatchId ?? rememberedBatchId)
  // A remembered or linked batch may since have been deleted (or be a hidden
  // week batch); the API answers those with no batch, so fall back to the default.
  if ((urlBatchId || rememberedBatchId) && !body.batch) {
    if (rememberedBatchId) cookies.delete(LAST_BATCH_COOKIE, { path: '/stats' })
    body = await fetchStats(null)
  }
  if (urlBatchId && body.batch) {
    cookies.set(LAST_BATCH_COOKIE, urlBatchId, {
      path: '/stats',
      httpOnly: true,
      sameSite: 'lax',
      secure: url.protocol === 'https:',
      maxAge: LAST_BATCH_MAX_AGE,
    })
  }

  // Stat rows carry the Riot name from the import; claimed players are shown
  // under their chosen profile name instead, like everywhere else on the site.
  const rows = body.rows ?? []
  const profileIds = Array.from(
    new Set(
      (rows as Record<string, unknown>[])
        .map((r) => r.profile_id)
        .filter((id): id is string => typeof id === 'string')
    )
  )
  if (profileIds.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name')
      .in('id', profileIds)
    const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.display_name || null]))
    for (const r of rows as Record<string, unknown>[]) {
      r.profile_name =
        typeof r.profile_id === 'string' ? (nameById.get(r.profile_id) ?? null) : null
    }
  }

  // Unclaimed rows: players who never logged in may still have a name an admin
  // set on their match identity.
  if ((rows as Record<string, unknown>[]).some((r) => !r.profile_id)) {
    const identityNames = await loadIdentityDisplayNames().catch((err) => {
      console.warn('Failed to load identity display names for stats:', err)
      return new Map<string, string>()
    })
    if (identityNames.size > 0) {
      for (const r of rows as Record<string, unknown>[]) {
        if (r.profile_id) continue
        const key = String(r.player_name ?? '')
          .trim()
          .toLowerCase()
        r.profile_name = identityNames.get(key) ?? identityNames.get(key.split('#')[0]) ?? null
      }
    }
  }

  let viewer: { profileId: string; displayName: string | null } | null = null
  if (locals.user) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name')
      .eq('auth0_sub', locals.user.sub)
      .maybeSingle()

    if (profile?.id) {
      viewer = { profileId: profile.id, displayName: profile.display_name ?? null }
    }
  }

  let batches: NormalizedRivalsGroupStatBatch[] = []
  const { data: batchRows, error: batchError } = await withSectionFallback<StatImportBatchRow[]>(
    (select) =>
      supabaseAdmin
        .from('stat_import_batches')
        .select(select)
        .filter('metadata->>import_type', 'eq', 'rivals_group_stats')
        // A live batch created before its event has no rows yet. It is real and
        // editable in admin, but listing an empty "Season 5 Playoffs" for
        // visitors is just a dead end.
        .gt('row_count', 0)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(100)
        .returns<StatImportBatchRow[]>()
  )

  if (!batchError) {
    batches = (batchRows ?? [])
      .map((b: StatImportBatchRow) =>
        normalizeRivalsGroupStatBatchFromDb(b, {
          displayNameFallback: 'source_filename',
        })
      )
      .filter((b) => !isWeekBatch(b))
  }

  // One synthetic "Full Season" entry per season whose phase batches are present
  // in the list above. These carry no DB row — the API sums them on demand from
  // the `season:<code>` id — so they are prepended to the picker rather than
  // read from `stat_import_batches`.
  const presentBatchIds = new Set(batches.map((b) => b.id))
  const { data: seasonRows } = await supabaseAdmin
    .from('seasons')
    .select('id, code, name, kind, metadata, starts_on, created_at')
    .order('starts_on', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  const fullSeasonBatches: NormalizedRivalsGroupStatBatch[] = (seasonRows ?? [])
    .filter((s) => {
      const ids = resolveSeasonStatBatchIds(s)
      return ids.length > 0 && ids.some((id) => presentBatchIds.has(id))
    })
    .map((s) => ({
      id: toFullSeasonBatchId(s.code as string),
      display_name: `${(s.name as string | null) ?? 'Season'} (Full)`,
      source_filename: null,
      import_kind: 'aggregate',
      week_label: null,
      section: 'full',
      created_at: null,
      sort_order: null,
    }))

  batches = [...fullSeasonBatches, ...batches]

  // The picker groups batches by event, then offers each event's phases. A
  // season's curated batches take the season's name; anything else (combined
  // postseason files, other regions, side leagues) is read from its own name and
  // folded into a season when the two names agree.
  const tidy = (s: string) => s.replace(/\s+/g, ' ').trim()
  const seasonOrderByName = new Map<string, number>()
  const seasonNameByBatch = new Map<string, string>()
  const seasonNameById = new Map<string, string>()
  const externalSeasonNames = new Set<string>()
  ;(seasonRows ?? []).forEach((s, index) => {
    const name = tidy((s.name as string | null) ?? '')
    if (!name) return
    seasonOrderByName.set(name.toLowerCase(), index)
    seasonNameById.set(s.id as string, name)
    if (s.kind === 'external') externalSeasonNames.add(name.toLowerCase())
    seasonNameByBatch.set(toFullSeasonBatchId(s.code as string), name)
    for (const id of resolveSeasonStatBatchIds(s)) seasonNameByBatch.set(id, name)
  })

  // Batches generated from imported matches record the season they came from,
  // which is the only reliable way to tell an external event's batch apart —
  // CSV-era batches carry nothing and are always rivals.
  for (const row of batchRows ?? []) {
    const sourceSeasonId = (row.metadata as { source_season_id?: string | null } | null)
      ?.source_season_id
    const name = sourceSeasonId ? seasonNameById.get(sourceSeasonId) : undefined
    if (name && !seasonNameByBatch.has(row.id)) seasonNameByBatch.set(row.id, name)
  }

  const pickerBatches = batches.map((b) => ({
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
  pickerBatches.forEach((b, i) => {
    if (!firstSeen.has(b.event)) firstSeen.set(b.event, i)
  })
  const events = [...firstSeen.keys()]
    .sort((a, z) => eventRank(a) - eventRank(z) || firstSeen.get(a)! - firstSeen.get(z)!)
    .map((name) => ({ name, external: externalSeasonNames.has(name.toLowerCase()) }))

  return {
    batchId: body.batchId ?? null,
    batch: body.batch ?? null,
    isExternal: body.seasonKind === 'external',
    rows,
    batches: pickerBatches,
    events,
    viewer,
    initialQ,
    initialMinGames,
    initialSort,
    initialDir,
    initialRankSort,
    initialDisregardTier,
  }
}
