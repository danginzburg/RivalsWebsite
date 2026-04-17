import { error, redirect, type Actions } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'
import { normalizeRiotBase, isValidRiotBase } from '$lib/server/riot-id'
import { supabaseErrorMessageIncludes } from '$lib/server/supabase/errors'
import { claimRelinkAfterProfileUpdate } from '$lib/server/players/claim-relink'

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/auth/login?returnTo=/account')

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, email, role, riot_id_base')
    .eq('auth0_sub', locals.user.sub)
    .maybeSingle()

  if (profileError) {
    const msg = String((profileError as { message?: string }).message ?? '')
    if (supabaseErrorMessageIncludes(profileError, 'riot_id_base')) {
      throw error(500, 'Database missing profiles.riot_id_base; apply the Supabase migration')
    }
    throw error(500, msg || 'Failed to load profile')
  }
  if (!profile) throw error(404, 'Profile not found')

  // Treat /account as a setup entrypoint; player page hosts the full view.
  throw redirect(303, `/players/${profile.id}`)
}

export const actions: Actions = {
  default: async ({ locals, request }) => {
    if (!locals.user) throw redirect(303, '/auth/login?returnTo=/account')
    const form = await request.formData()
    const riotIdBase = normalizeRiotBase(form.get('riot_id_base'))
    if (!isValidRiotBase(riotIdBase)) {
      return { success: false, message: 'Enter a valid Riot ID base name (no #tag).' }
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('auth0_sub', locals.user.sub)
      .maybeSingle()

    if (!profile?.id) throw error(404, 'Profile not found')

    // Check uniqueness (case-insensitive)
    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .ilike('riot_id_base', riotIdBase)
      .neq('id', profile.id)
      .maybeSingle()

    if (existing?.id) {
      return { success: false, message: 'That Riot ID is already claimed by another account.' }
    }

    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ riot_id_base: riotIdBase })
      .eq('id', profile.id)

    if (updateError) return { success: false, message: updateError.message }

    try {
      await claimRelinkAfterProfileUpdate(profile.id)
    } catch (err) {
      console.warn('claimRelinkAfterProfileUpdate failed:', err)
    }

    throw redirect(303, `/players/${profile.id}`)
  },
}
