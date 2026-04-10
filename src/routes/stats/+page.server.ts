import type { PageServerLoad } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'
import { safeInt } from '$lib/server/parse'
import {
  normalizeRivalsGroupStatBatchFromDb,
  type NormalizedRivalsGroupStatBatch,
  type StatImportBatchRow,
} from '$lib/server/stats/rivals-batch'

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
    'rounds',
    'rounds_won',
    'rounds_lost',
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
  const { data: batchRows, error: batchError } = await supabaseAdmin
    .from('stat_import_batches')
    .select(
      'id, source_filename, display_name, import_kind, week_label, created_at, metadata, sort_order'
    )
    .filter('metadata->>import_type', 'eq', 'rivals_group_stats')
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(100)

  if (!batchError) {
    batches = (batchRows ?? []).map((b: StatImportBatchRow) =>
      normalizeRivalsGroupStatBatchFromDb(b, {
        displayNameFallback: 'source_filename',
      })
    )
  }

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
  }
}
