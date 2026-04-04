import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const POST: RequestHandler = async ({ locals, params, request }) => {
  await requireAdmin(locals.user)

  const matchId = normalizeOptional(params.id)
  if (!matchId) throw error(400, 'Missing match id')

  const body = await request.json().catch(() => ({}))
  const platform = normalizeOptional(body.platform) ?? 'other'
  const streamUrl = normalizeOptional(body.streamUrl)
  const status = normalizeOptional(body.status) ?? 'scheduled'
  const isPrimary = Boolean(body.isPrimary)

  if (!streamUrl) throw error(400, 'Stream URL is required')
  if (!['twitch', 'youtube', 'kick', 'other'].includes(platform))
    throw error(400, 'Invalid platform')
  if (!['scheduled', 'live', 'ended'].includes(status)) throw error(400, 'Invalid stream status')

  if (isPrimary) {
    await supabaseAdmin.from('match_streams').update({ is_primary: false }).eq('match_id', matchId)
  }

  const { data: created, error: createError } = await supabaseAdmin
    .from('match_streams')
    .insert({
      match_id: matchId,
      platform,
      stream_url: streamUrl,
      status,
      is_primary: isPrimary,
    })
    .select('id, match_id, platform, stream_url, status, is_primary')
    .single()

  if (createError || !created) throw error(500, 'Failed to add stream')
  return json({ success: true, stream: created })
}

export const DELETE: RequestHandler = async ({ locals, request }) => {
  await requireAdmin(locals.user)

  const body = await request.json().catch(() => ({}))
  const streamId = normalizeOptional(body.streamId)
  if (!streamId) throw error(400, 'Missing streamId')

  const { error: deleteError } = await supabaseAdmin
    .from('match_streams')
    .delete()
    .eq('id', streamId)
  if (deleteError) throw error(500, 'Failed to delete stream')

  return json({ success: true })
}
