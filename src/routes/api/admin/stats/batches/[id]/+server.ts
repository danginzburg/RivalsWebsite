import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { logAdminAction } from '$lib/server/audit/admin-actions'
import { normalizeSectionKey } from '$lib/stats/sections'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  await requireAdmin(locals.user)
  const id = params.id
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw error(400, 'Invalid batch id')

  const body = await request.json().catch(() => ({}))

  // Each field is only touched when the caller sent it, so the section editor
  // and the order editor can post independently without clobbering each other.
  const patch: Record<string, unknown> = {}

  if ('sortOrder' in body) {
    const sortOrderRaw = normalizeOptional(body.sortOrder)
    const sortOrder = sortOrderRaw === null ? null : Number(sortOrderRaw)
    if (sortOrderRaw !== null && !Number.isFinite(sortOrder)) {
      throw error(400, 'sortOrder must be a number')
    }
    patch.sort_order = sortOrder
  }

  if ('section' in body) {
    const raw = normalizeOptional(body.section)
    // Blank clears the section, so the batch falls back to name inference.
    if (raw !== null && normalizeSectionKey(raw) === null) throw error(400, 'Unknown section')
    patch.section = raw === null ? null : normalizeSectionKey(raw)
  }

  if ('displayName' in body) {
    const displayName = normalizeOptional(body.displayName)
    if (!displayName) throw error(400, 'A batch name is required')
    if (displayName.length > 120) throw error(400, 'That batch name is too long')
    patch.display_name = displayName
  }

  // Whether the batch keeps rebuilding itself lives in metadata alongside the
  // rest of its generation config, so it is read and merged rather than set.
  if ('autoRefresh' in body) {
    const { data: existing, error: readError } = await supabaseAdmin
      .from('stat_import_batches')
      .select('metadata')
      .eq('id', id)
      .maybeSingle()

    if (readError || !existing) throw error(404, 'Batch not found')

    const metadata = (existing.metadata ?? {}) as Record<string, unknown>
    if (!metadata.generated_from_matches) {
      throw error(400, 'Only batches generated from matches can refresh themselves')
    }
    patch.metadata = { ...metadata, auto_refresh: Boolean(body.autoRefresh) }
  }

  if (Object.keys(patch).length === 0) throw error(400, 'Nothing to update')

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('stat_import_batches')
    .update(patch)
    .eq('id', id)
    .select('id, display_name, section, sort_order')
    .single()

  if (updateError || !updated) throw error(500, 'Failed to update batch')

  return json({ success: true, batch: updated })
}

/**
 * Delete a batch and the stat rows behind it.
 *
 * `rivals_group_stats` has no FK to `stat_import_batches`, so the rows have to
 * go first and explicitly — dropping only the batch would leave orphaned rows
 * that no page can reach and no admin can find.
 */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  const admin = await requireAdmin(locals.user)
  const id = params.id
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw error(400, 'Invalid batch id')

  const { data: batch, error: readError } = await supabaseAdmin
    .from('stat_import_batches')
    .select('id, display_name, row_count')
    .eq('id', id)
    .maybeSingle()

  if (readError) throw error(500, 'Failed to load batch')
  if (!batch) throw error(404, 'Batch not found')

  const { error: rowsError } = await supabaseAdmin
    .from('rivals_group_stats')
    .delete()
    .eq('import_batch_id', id)
  if (rowsError) throw error(500, 'Failed to delete the batch stat rows')

  const { error: deleteError } = await supabaseAdmin
    .from('stat_import_batches')
    .delete()
    .eq('id', id)
  if (deleteError) throw error(500, 'Failed to delete batch')

  await logAdminAction({
    adminProfileId: admin.id,
    actionType: 'stat_batch_deleted',
    targetTable: 'stat_import_batches',
    targetId: id,
    details: { displayName: batch.display_name, rowCount: batch.row_count },
  })

  return json({ success: true })
}
