import type { PageServerLoad } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'
import { safeInt } from '$lib/server/parse'
import {
  normalizeRivalsGroupStatBatchFromDb,
  withSectionFallback,
  type NormalizedRivalsGroupStatBatch,
  type StatImportBatchRow,
} from '$lib/server/stats/rivals-batch'
import { resolveSeasonStatBatchIds, toFullSeasonBatchId } from '$lib/server/stats/season-batches'

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
    'clutches_won',
    'clutches_attempted',
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

export const load: PageServerLoad = async ({ fetch, url, locals }) => {
  const batchId = url.searchParams.get('batchId')
  const initialQ = String(url.searchParams.get('q') ?? '')
  const initialMinGames = Math.max(0, safeInt(url.searchParams.get('minGames'), 0))
  const initialSort = normalizeSort(url.searchParams.get('sort'))
  const initialDir = normalizeDir(url.searchParams.get('dir'), initialSort)
  // Toggles ride in the URL because changing batch is a full navigation,
  // which would otherwise reset them.
  // Weeks are hidden unless explicitly switched off, so the batch list opens
  // on the season aggregates most visitors are after.
  const initialHideWeeks = url.searchParams.get('hideWeeks') !== '0'
  const initialRankSort = url.searchParams.get('rankSort') === '1'
  const initialDisregardTier = url.searchParams.get('ignoreTier') === '1'

  const res = await fetch(
    `/api/stats?limit=500${batchId ? `&batchId=${encodeURIComponent(batchId)}` : ''}`
  )

  const body = await res.json().catch(() => ({}))

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
    batches = (batchRows ?? []).map((b: StatImportBatchRow) =>
      normalizeRivalsGroupStatBatchFromDb(b, {
        displayNameFallback: 'source_filename',
      })
    )
  }

  // One synthetic "Full Season" entry per season whose phase batches are present
  // in the list above. These carry no DB row — the API sums them on demand from
  // the `season:<code>` id — so they are prepended to the picker rather than
  // read from `stat_import_batches`.
  const presentBatchIds = new Set(batches.map((b) => b.id))
  const { data: seasonRows } = await supabaseAdmin
    .from('seasons')
    .select('code, name, metadata, starts_on, created_at')
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

  return {
    batchId: body.batchId ?? null,
    batch: body.batch ?? null,
    rows: body.rows ?? [],
    batches,
    viewer,
    initialQ,
    initialMinGames,
    initialSort,
    initialDir,
    initialHideWeeks,
    initialRankSort,
    initialDisregardTier,
  }
}
