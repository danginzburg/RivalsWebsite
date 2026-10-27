import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'

export const GET: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals.user)

  const { data: profiles, error: loadError } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, email, created_at')
    .order('display_name', { ascending: true })
  if (loadError) throw error(500, 'Failed to load users')

  const normalized = (profiles ?? []).map((p) => ({
    profile_id: p.id,
    display_name: p.display_name ?? null,
    email: p.email ?? null,
    created_at: p.created_at ?? null,
  }))

  return json({ players: normalized })
}
