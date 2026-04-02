import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'

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
  const sortOrderRaw = normalizeOptional(body.sortOrder)
  const sortOrder = sortOrderRaw === null ? null : Number(sortOrderRaw)
  if (sortOrderRaw !== null && !Number.isFinite(sortOrder)) {
    throw error(400, 'sortOrder must be a number')
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('stat_import_batches')
    .update({ sort_order: sortOrder })
    .eq('id', id)
    .select('id, sort_order')
    .single()

  if (updateError || !updated) throw error(500, 'Failed to update batch order')

  return json({ success: true, batch: updated })
}
