import { redirect, error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    throw redirect(303, '/auth/login?returnTo=/admin/stats-import')
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, role')
    .eq('auth0_sub', locals.user.sub)
    .single()

  if (profileError || !profile) {
    throw error(403, 'Profile not found')
  }

  if (profile.role !== 'admin') {
    throw error(403, 'Access denied. Administrator privileges required.')
  }

  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, riot_id_base')
    .order('display_name', { ascending: true })

  if (profilesError) {
    const msg = String((profilesError as any).message ?? '')
    if (msg.toLowerCase().includes('riot_id_base')) {
      throw error(500, 'Database missing profiles.riot_id_base; apply the Supabase migration')
    }
    throw error(500, msg || 'Failed to load profiles')
  }

  return {
    profiles: profiles ?? [],
  }
}
