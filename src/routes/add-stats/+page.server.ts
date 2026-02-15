import { redirect, error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    throw redirect(303, '/auth/login?returnTo=/add-stats')
  }

  // Check if user is an admin
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

  // Fetch registered players for player name matching on the client
  const { data: registrations } = await supabaseAdmin
    .from('player_registration')
    .select(
      `
        profile_id,
        riot_id,
        profiles!player_registration_profile_id_fkey (
          display_name
        )
      `
    )
    .order('riot_id')

  return {
    profiles: (registrations ?? []).map((reg) => {
      const profileRel = Array.isArray(reg.profiles) ? reg.profiles[0] : reg.profiles
      return {
        id: reg.profile_id,
        display_name: profileRel?.display_name ?? null,
        riot_id: reg.riot_id ?? null,
      }
    }),
  }
}
