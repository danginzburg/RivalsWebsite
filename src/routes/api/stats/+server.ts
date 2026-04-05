import { error, json, type RequestHandler } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'

function safeInt(value: string | null, fallback: number) {
  if (!value) return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function extractNumericLabel(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const m = value.match(/(\d+)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

function isLatestLabel(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return value.trim().toLowerCase().includes('latest')
}

export const GET: RequestHandler = async ({ url }) => {
  const batchId = url.searchParams.get('batchId')
  const onlyMatched = url.searchParams.get('onlyMatched') === 'true'
  const limit = Math.min(500, Math.max(1, safeInt(url.searchParams.get('limit'), 100)))
  const sort = (url.searchParams.get('sort') ?? 'acs').toLowerCase()

  let effectiveBatchId = batchId
  if (!effectiveBatchId) {
    // Default batch selection:
    // Prefer aggregate imports and sort by label (Season N) rather than upload time.
    const { data: batchRows, error: batchError } = await supabaseAdmin
      .from('stat_import_batches')
      .select('id, display_name, import_kind, week_label, created_at, metadata, sort_order')
      .filter('metadata->>import_type', 'eq', 'rivals_group_stats')
      .order('created_at', { ascending: false })
      .limit(200)

    if (batchError) throw error(500, 'Failed to load stats')

    const normalized = (batchRows ?? []).map((b: any) => ({
      id: b.id,
      display_name: b.display_name ?? '',
      import_kind: b.import_kind ?? b.metadata?.import_kind ?? null,
      week_label: b.week_label ?? b.metadata?.week_label ?? null,
      created_at: b.created_at,
      sort_order: b.sort_order ?? null,
    }))

    const aggregates = normalized.filter((b) => b.import_kind === 'aggregate')
    const weeklies = normalized.filter((b) => b.import_kind === 'weekly')

    const pickFrom = (arr: any[]) => {
      if (arr.length === 0) return null
      const copy = [...arr]
      copy.sort((a, b) => {
        const ao = a.sort_order
        const bo = b.sort_order
        if (typeof ao === 'number' && typeof bo === 'number' && ao !== bo) return ao - bo
        if (typeof ao === 'number' && typeof bo !== 'number') return -1
        if (typeof ao !== 'number' && typeof bo === 'number') return 1

        const aName = a.display_name ?? ''
        const bName = b.display_name ?? ''

        const aLatest = isLatestLabel(aName)
        const bLatest = isLatestLabel(bName)
        if (aLatest !== bLatest) return aLatest ? -1 : 1

        const na = extractNumericLabel(aName)
        const nb = extractNumericLabel(bName)
        if (na !== null && nb !== null && na !== nb) return nb - na

        const ta = a.created_at ? new Date(a.created_at).getTime() : 0
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0
        if (ta !== tb) return tb - ta

        return String(aName).localeCompare(String(bName))
      })
      return copy[0]
    }

    const pick = pickFrom(aggregates) ?? pickFrom(weeklies)
    effectiveBatchId = pick?.id ?? null
  }

  if (!effectiveBatchId) return json({ batchId: null, batch: null, rows: [] })

  let batch: any | null = null
  const { data: batchRow, error: batchError } = await supabaseAdmin
    .from('stat_import_batches')
    .select('id, source_filename, display_name, import_kind, week_label, created_at, metadata')
    .eq('id', effectiveBatchId)
    .maybeSingle()

  if (!batchError && batchRow) {
    batch = {
      id: batchRow.id,
      source_filename: batchRow.source_filename,
      display_name: batchRow.display_name ?? batchRow.source_filename,
      import_kind: batchRow.import_kind ?? batchRow.metadata?.import_kind ?? null,
      week_label: batchRow.week_label ?? batchRow.metadata?.week_label ?? null,
      created_at: batchRow.created_at,
    }
  }

  let query = supabaseAdmin
    .from('rivals_group_stats')
    .select(
      'id, player_name, profile_id, agents, games, games_won, games_lost, rounds, rounds_won, rounds_lost, acs, kd, kast_pct, adr, kills, deaths, assists, fk, fd, hs_pct, econ_rating, kpg, kpr, dpg, dpr, apg, apr, fkpg, fdpg, plants, plants_per_game, defuses, defuses_per_game, import_batch_id, imported_at'
    )
    .eq('import_batch_id', effectiveBatchId)

  if (onlyMatched) {
    query = query.not('profile_id', 'is', null)
  }

  // Sort by a few safe columns.
  if (sort === 'kd') query = query.order('kd', { ascending: false, nullsFirst: false })
  else if (sort === 'kast') query = query.order('kast_pct', { ascending: false, nullsFirst: false })
  else if (sort === 'adr') query = query.order('adr', { ascending: false, nullsFirst: false })
  else query = query.order('acs', { ascending: false, nullsFirst: false })

  const { data: rows, error: rowsError } = await query.limit(limit)
  if (rowsError) throw error(500, 'Failed to load stats')

  return json({
    batchId: effectiveBatchId,
    batch,
    rows: rows ?? [],
  })
}
