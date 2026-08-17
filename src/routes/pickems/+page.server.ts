import { error, redirect } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async () => {
  const { data: season } = await supabaseAdmin
    .from('seasons')
    .select('code, pickem_events!inner (status)')
    .eq('is_active', true)
    .neq('pickem_events.status', 'draft')
    .maybeSingle()

  if (season?.code) {
    throw redirect(302, `/pickems/${season.code}`)
  }

  throw error(404, "No active Pick'em")
}
