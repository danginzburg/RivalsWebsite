import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'

export const GET: RequestHandler = async ({ locals, params }) => {
  await requireAdmin(locals.user)
  const matchId = params.id

  const { data: maps, error: mapsError } = await supabaseAdmin
    .from('match_maps')
    .select('*')
    .eq('match_id', matchId)
    .order('map_order', { ascending: true })

  if (mapsError) throw error(500, 'Failed to load maps')

  const normalized = (maps ?? []).map((m: any) => ({
    id: m.id,
    map_order: m.map_order,
    map_name: m.map_name ?? null,
    is_voided: m.is_voided ?? false,
  }))

  return json({ maps: normalized })
}
