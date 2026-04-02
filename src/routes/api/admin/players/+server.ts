import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'

export const GET: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals.user)

  let profiles: any[] | null = null
  {
    const { data, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, email, riot_id_base, created_at')
      .order('display_name', { ascending: true })

    if (profilesError) {
      const msg = String((profilesError as any).message ?? '')
      if (msg.toLowerCase().includes('riot_id_base')) {
        // Backwards compatibility if migration wasn't applied yet.
        const { data: fallback, error: fallbackError } = await supabaseAdmin
          .from('profiles')
          .select('id, display_name, email, created_at')
          .order('display_name', { ascending: true })
        if (fallbackError) throw error(500, 'Failed to load users')
        profiles = (fallback ?? []).map((p: any) => ({ ...p, riot_id_base: null }))
      } else {
        throw error(500, 'Failed to load users')
      }
    } else {
      profiles = data ?? []
    }
  }

  const normalized = (profiles ?? []).map((p: any) => ({
    profile_id: p.id,
    riot_id_base: p.riot_id_base ?? null,
    display_name: p.display_name ?? null,
    email: p.email ?? null,
    created_at: p.created_at ?? null,
  }))

  return json({ players: normalized })
}
