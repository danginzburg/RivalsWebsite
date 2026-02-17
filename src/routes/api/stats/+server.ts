import { error, json, type RequestHandler } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'

function safeInt(value: string | null, fallback: number) {
  if (!value) return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export const GET: RequestHandler = async ({ url }) => {
  const batchId = url.searchParams.get('batchId')
  const onlyMatched = url.searchParams.get('onlyMatched') === 'true'
  const limit = Math.min(500, Math.max(1, safeInt(url.searchParams.get('limit'), 100)))
  const sort = (url.searchParams.get('sort') ?? 'acs').toLowerCase()

  let effectiveBatchId = batchId
  if (!effectiveBatchId) {
    // Latest batch by imported_at
    const { data: latest, error: latestError } = await supabaseAdmin
      .from('rivals_group_stats')
      .select('import_batch_id')
      .order('imported_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latestError) throw error(500, 'Failed to load stats')
    effectiveBatchId = latest?.import_batch_id ?? null
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

  return json({ batchId: effectiveBatchId, batch, rows: rows ?? [] })
}
