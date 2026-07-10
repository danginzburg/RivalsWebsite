import { redirect } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async () => {
  const { data: season } = await supabaseAdmin
    .from('seasons')
    .select('code')
    .eq('is_active', true)
    .maybeSingle()

  if (season?.code) {
    throw redirect(302, `/pickems/${season.code}`)
  }

  const { data: latest } = await supabaseAdmin
    .from('seasons')
    .select('code')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latest?.code) {
    throw redirect(302, `/pickems/${latest.code}`)
  }

  throw redirect(302, '/')
}
