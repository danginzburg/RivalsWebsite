import { error, redirect } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async () => {
  const { data: season } = await supabaseAdmin
    .from('seasons')
    .select('code, metadata')
    .eq('is_active', true)
    .maybeSingle()

  if (season?.code) {
    const meta = season.metadata as Record<string, unknown> | null
    const pickemConfig = meta?.playoff_pickem as Record<string, unknown> | undefined
    if (pickemConfig?.enabled && pickemConfig?.status !== 'draft') {
      throw redirect(302, `/pickems/${season.code}`)
    }
  }

  throw error(404, "No active Pick'em")
}
