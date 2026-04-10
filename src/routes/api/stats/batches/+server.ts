import { error, json, type RequestHandler } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { safeInt } from '$lib/server/parse'
import {
  normalizeRivalsGroupStatBatchFromDb,
  type StatImportBatchRow,
} from '$lib/server/stats/rivals-batch'

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

  const normalized = (batches ?? []).map((b: StatImportBatchRow) =>
    normalizeRivalsGroupStatBatchFromDb(b, {
      displayNameFallback: 'source_filename',
    })
  )

  return json({ batches: normalized })
}
