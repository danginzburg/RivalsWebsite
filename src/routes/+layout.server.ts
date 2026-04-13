import { pickemConfigFromSeasonMetadata } from '$lib/server/pickems'
import { supabaseAdmin } from '$lib/supabase/admin'

import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async ({ locals }) => {
  const { data: pickemSeason } = await supabaseAdmin
    .from('seasons')
    .select('code, metadata')
    .eq('is_active', true)
    .maybeSingle()

  return {
    user: locals.user,
    activePickemSeasonCode:
      pickemSeason && pickemConfigFromSeasonMetadata(pickemSeason.metadata).enabled
        ? pickemSeason.code
        : null,
  }
}
