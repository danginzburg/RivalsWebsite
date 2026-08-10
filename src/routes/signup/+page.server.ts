import { redirect, fail } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { requireProfile } from '$lib/server/auth/profile'
import { normalizeRiotBase, isValidRiotBase } from '$lib/server/riot-id'
import {
  normalizeDiscordHandle,
  normalizeTrackerLinks,
  MAX_TRACKER_LINKS,
} from '$lib/server/signups'

const SIGNUP_COLUMNS = `
  id,
  display_name,
  discord_handle,
  tracker_links,
  current_rank,
  peak_rank,
  computed_value,
  manual_value_override,
  status,
  admin_notes,
  created_at,
  updated_at
`

async function loadActiveSeason() {
  const { data } = await supabaseAdmin
    .from('seasons')
    .select('id, code, name')
    .eq('is_active', true)
    .maybeSingle()
  return data
}

async function loadSignup(profileId: string, seasonId: string) {
  const { data } = await supabaseAdmin
    .from('player_signups')
    .select(SIGNUP_COLUMNS)
    .eq('profile_id', profileId)
    .eq('season_id', seasonId)
    .maybeSingle()
  return data
}

export const load = async ({ locals }: { locals: App.Locals }) => {
  if (!locals.user) throw redirect(303, '/auth/login?returnTo=/signup')

  const profile = await requireProfile(locals.user)
  const activeSeason = await loadActiveSeason()

  // requireProfile only selects a few columns, so read the contact fields the
  // form pre-fills from directly.
  const { data: profileDetail } = await supabaseAdmin
    .from('profiles')
    .select('riot_id_base, discord_handle')
    .eq('id', profile.id)
    .maybeSingle()

  const existing = activeSeason ? await loadSignup(profile.id, activeSeason.id) : null

  return {
    profile: {
      id: profile.id,
      display_name: profile.display_name ?? null,
      riot_id_base: profileDetail?.riot_id_base ?? null,
      // Stored handle first, then the username from the Discord login itself.
      discord_handle: profileDetail?.discord_handle ?? locals.user.discord_username ?? null,
    },
    activeSeason,
    signup: existing,
    maxTrackerLinks: MAX_TRACKER_LINKS,
  }
}

export const actions = {
  /**
   * Create or update the signed-in player's signup for the active season.
   *
   * Rank and tracker scores are deliberately NOT accepted here — those are
   * set by an admin from the tracker links the player provides, so a player
   * cannot inflate their own rating.
   */
  submit: async ({ locals, request }: { locals: App.Locals; request: Request }) => {
    if (!locals.user) throw redirect(303, '/auth/login?returnTo=/signup')
    const profile = await requireProfile(locals.user)

    const form = await request.formData()

    const riotId = normalizeRiotBase(form.get('riotId'))
    if (!isValidRiotBase(riotId)) {
      return fail(400, {
        success: false,
        message: 'Enter a valid Riot ID name (3–24 characters, no #tag).',
      })
    }

    const discordHandle = normalizeDiscordHandle(form.get('discordHandle'))

    // Labels are derived from each URL's hostname, so only the URL is collected.
    const trackerLinks = normalizeTrackerLinks(
      form.getAll('trackerUrl').map((url) => ({ label: '', url: String(url) }))
    )

    if (trackerLinks.length === 0) {
      return fail(400, {
        success: false,
        message: 'Add at least one tracker link so an admin can verify your rank.',
      })
    }

    const activeSeason = await loadActiveSeason()
    if (!activeSeason) {
      return fail(400, {
        success: false,
        message: 'Signups are closed — there is no active season right now.',
      })
    }

    // One signup per player per season. An approved signup is locked so a
    // player cannot quietly change their details after being rated.
    const existing = await loadSignup(profile.id, activeSeason.id)
    if (existing?.status === 'approved') {
      return fail(409, {
        success: false,
        message:
          'Your signup has been approved and can no longer be edited. Contact an admin if something needs changing.',
      })
    }

    // The Riot ID must not already belong to someone else.
    const { data: riotIdOwner } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .ilike('riot_id_base', riotId)
      .neq('id', profile.id)
      .maybeSingle()

    if (riotIdOwner?.id) {
      return fail(409, {
        success: false,
        message: 'That Riot ID is already linked to another account.',
      })
    }

    const payload = {
      profile_id: profile.id,
      season_id: activeSeason.id,
      // Riot ID is the canonical identity across the site.
      display_name: riotId,
      discord_handle: discordHandle,
      tracker_links: trackerLinks,
      // Editing returns the signup to review.
      status: 'pending' as const,
    }

    const { error: upsertError } = await supabaseAdmin
      .from('player_signups')
      .upsert(payload, { onConflict: 'profile_id,season_id' })

    if (upsertError) {
      console.error('Failed to save signup:', upsertError)
      return fail(500, { success: false, message: 'Failed to save your signup. Try again.' })
    }

    // Keep the profile's Riot ID in step so stats matching uses the same name.
    await supabaseAdmin.from('profiles').update({ riot_id_base: riotId }).eq('id', profile.id)

    return {
      success: true,
      message: existing
        ? 'Signup updated. An admin will review it again.'
        : 'Signup submitted. An admin will review it shortly.',
    }
  },

  /** Withdraw a signup that has not been approved yet. */
  withdraw: async ({ locals }: { locals: App.Locals }) => {
    if (!locals.user) throw redirect(303, '/auth/login?returnTo=/signup')
    const profile = await requireProfile(locals.user)

    const activeSeason = await loadActiveSeason()
    if (!activeSeason) {
      return fail(400, { success: false, message: 'There is no active season right now.' })
    }

    const existing = await loadSignup(profile.id, activeSeason.id)
    if (!existing) {
      return fail(404, { success: false, message: 'You do not have a signup to withdraw.' })
    }
    if (existing.status === 'approved') {
      return fail(409, {
        success: false,
        message: 'Approved signups cannot be withdrawn. Contact an admin.',
      })
    }

    const { error: deleteError } = await supabaseAdmin
      .from('player_signups')
      .delete()
      .eq('profile_id', profile.id)
      .eq('season_id', activeSeason.id)

    if (deleteError) {
      console.error('Failed to withdraw signup:', deleteError)
      return fail(500, { success: false, message: 'Failed to withdraw your signup. Try again.' })
    }

    return { success: true, message: 'Signup withdrawn.' }
  },
}
