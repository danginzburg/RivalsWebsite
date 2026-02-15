import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function todayIsoDate() {
  const d = new Date()
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export const POST: RequestHandler = async ({ locals, request }) => {
  await requireAdmin(locals.user)

  const body = await request.json().catch(() => ({}))
  const seasonId = normalizeOptional(body.seasonId)
  const asOfDate = normalizeOptional(body.asOfDate) ?? todayIsoDate()
  const split = normalizeOptional(body.split) ?? 'main'

  if (!seasonId) throw error(400, 'seasonId is required')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) throw error(400, 'asOfDate must be YYYY-MM-DD')

  const { data, error: rpcError } = await supabaseAdmin.rpc('create_weekly_leaderboard_snapshot', {
    p_season_id: seasonId,
    p_split: split,
    p_as_of_date: asOfDate,
  })

  if (rpcError) throw error(500, rpcError.message)
  return json({ success: true, inserted: data ?? 0 })
}
