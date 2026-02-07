import type { PageServerLoad } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    return { existingRegistration: null, canUpdate: false }
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role')
    .eq('auth0_sub', locals.user.sub)
    .maybeSingle()

  if (!profile) {
    return { existingRegistration: null, canUpdate: false }
  }

  const { data: existingRegistration } = await supabaseAdmin
    .from('player_registration')
    .select('id, riot_id, pronouns, tracker_links')
    .eq('profile_id', profile.id)
    .maybeSingle()

  return {
    existingRegistration: existingRegistration ?? null,
    canUpdate: Boolean(existingRegistration),
  }
}
