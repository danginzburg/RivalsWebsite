import type { PageServerLoad } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    return { hasObserverRegistration: false }
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('auth0_sub', locals.user.sub)
    .maybeSingle()

  if (!profile) {
    return { hasObserverRegistration: false }
  }

  const { data: existingRegistration } = await supabaseAdmin
    .from('observer_registration')
    .select('id')
    .eq('profile_id', profile.id)
    .maybeSingle()

  return {
    hasObserverRegistration: Boolean(existingRegistration),
  }
}
