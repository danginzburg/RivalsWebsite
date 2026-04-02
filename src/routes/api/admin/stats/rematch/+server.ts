import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const POST: RequestHandler = async ({ locals, request }) => {
  await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const batchId = normalizeOptional(body.batchId)
  if (batchId && !/^[0-9a-f-]{36}$/i.test(batchId)) {
    throw error(400, 'Invalid batchId')
  }

  const { data, error: rpcError } = await supabaseAdmin.rpc('rematch_rivals_group_stats', {
    batch_id: batchId,
  })

  if (rpcError) {
    const msg = String((rpcError as any).message ?? '')
    if (msg.toLowerCase().includes('rematch_rivals_group_stats')) {
      throw error(500, 'Missing rematch function; apply latest Supabase migrations')
    }
    throw error(500, 'Failed to rematch stats')
  }

  const row = Array.isArray(data) ? data[0] : data
  return json({
    success: true,
    updated: Number(row?.updated_count ?? 0),
    remaining_unmatched: Number(row?.remaining_unmatched ?? 0),
  })
}
