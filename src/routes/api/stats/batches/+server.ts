import { error, json, type RequestHandler } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'

function safeInt(value: string | null, fallback: number) {
  if (!value) return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export const GET: RequestHandler = async ({ url }) => {
  const limit = Math.min(200, Math.max(1, safeInt(url.searchParams.get('limit'), 50)))

  const { data: batches, error: batchesError } = await supabaseAdmin
    .from('stat_import_batches')
    .select('id, source_filename, display_name, import_kind, week_label, created_at, metadata')
    .filter('metadata->>import_type', 'eq', 'rivals_group_stats')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (batchesError) {
    // Table may not exist yet in some environments.
    return json({ batches: [] })
  }

  const normalized = (batches ?? []).map((b: any) => ({
    id: b.id,
    source_filename: b.source_filename,
    display_name: b.display_name ?? b.source_filename,
    import_kind: b.import_kind ?? b.metadata?.import_kind ?? null,
    week_label: b.week_label ?? b.metadata?.week_label ?? null,
    created_at: b.created_at,
  }))

  return json({ batches: normalized })
}
