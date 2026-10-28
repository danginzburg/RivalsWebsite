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
import { isWeekBatch } from '$lib/stats/sections'
import { groupBatchesByEvent } from '$lib/server/stats/batch-events'

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
  const initialView = url.searchParams.get('view') === 'graphs' ? 'graphs' : 'table'

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

  let viewer: { profileId: string; displayName: string | null; riotNames: string[] } | null = null
  if (locals.user) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name')
      .eq('auth0_sub', locals.user.sub)
      .maybeSingle()

    if (profile?.id) {
      // Stat rows imported before the player linked their account carry only
      // the Riot name, so Find me matches those as well as the profile id.
      const { data: directory } = await supabaseAdmin
        .from('player_directory')
        .select('riot_ids')
        .eq('profile_id', profile.id)
        .maybeSingle()
      const riotNames = new Set<string>()
      for (const id of (directory?.riot_ids as string[] | null) ?? []) {
        const full = String(id).trim().toLowerCase()
        if (!full) continue
        riotNames.add(full)
        riotNames.add(full.split('#')[0])
      }
      viewer = {
        profileId: profile.id,
        displayName: profile.display_name ?? null,
        riotNames: [...riotNames],
      }
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

  const { batches: pickerBatches, events } = groupBatchesByEvent(
    batches,
    seasonRows ?? [],
    batchRows ?? []
  )

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
    initialView,
  }
}
