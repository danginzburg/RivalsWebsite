import { error, redirect, type Actions } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'

function normalizeRiotBase(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  // Stats only use the name before the tag.
  const base = raw.split('#')[0].trim()
  return base
}

function isValidRiotBase(value: string) {
  if (!value) return false
  if (value.includes('#')) return false
  if (value.length < 3 || value.length > 24) return false
  return true
}

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/auth/login?returnTo=/account')

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, email, role, riot_id_base')
    .eq('auth0_sub', locals.user.sub)
    .maybeSingle()

  if (profileError) {
    const msg = String((profileError as any).message ?? '')
    if (msg.toLowerCase().includes('riot_id_base')) {
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

    // Best-effort auto-relink of imported stats after claiming Riot ID.
    const { error: rpcError } = await supabaseAdmin.rpc('rematch_rivals_group_stats', {
      batch_id: null,
    })
    if (rpcError) {
      console.warn('rematch_rivals_group_stats failed:', rpcError)
    }

    throw redirect(303, `/players/${profile.id}`)
  },
}
