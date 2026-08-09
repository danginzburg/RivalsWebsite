import { redirect, fail } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { requireProfile } from '$lib/server/auth/profile'
import {
  computeSignupValue,
  normalizeDiscordHandle,
  normalizeOptional,
  normalizeTrackerLinks,
  parseScore,
  MAX_TRACKER_LINKS,
} from '$lib/server/signups'

export const load = async ({ locals }: { locals: App.Locals }) => {
  if (!locals.user) throw redirect(303, '/auth/login?returnTo=/signup')

  const profile = await requireProfile(locals.user)

  const { data: activeSeason } = await supabaseAdmin
    .from('seasons')
    .select('id, code, name')
    .eq('is_active', true)
    .maybeSingle()

  // An existing signup for this season becomes the form's initial state.
  let existing = null
  if (activeSeason) {
    const { data } = await supabaseAdmin
      .from('player_signups')
      .select(
        `
        id,
        display_name,
        discord_handle,
        tracker_links,
        current_rank,
        peak_rank,
        tracker_current_score,
        tracker_peak_score,
        computed_value,
        manual_value_override,
        status,
        admin_notes,
        created_at
      `
      )
      .eq('profile_id', profile.id)
      .eq('season_id', activeSeason.id)
      .maybeSingle()
    existing = data
  }

  return {
    profile: {
      id: profile.id,
      display_name: profile.display_name ?? null,
      // Riot ID doubles as the display name when one has not been set.
      riot_id_base: (profile as { riot_id_base?: string | null }).riot_id_base ?? null,
    },
    activeSeason,
    signup: existing,
    maxTrackerLinks: MAX_TRACKER_LINKS,
  }
}

export const actions = {
  default: async ({ locals, request }: { locals: App.Locals; request: Request }) => {
    if (!locals.user) throw redirect(303, '/auth/login?returnTo=/signup')
    const profile = await requireProfile(locals.user)

    const form = await request.formData()

    const displayName = normalizeOptional(form.get('displayName'))
    const discordHandle = normalizeDiscordHandle(form.get('discordHandle'))
    const currentRank = normalizeOptional(form.get('currentRank'))
    const peakRank = normalizeOptional(form.get('peakRank'))
    const trackerCurrentScore = parseScore(form.get('trackerCurrentScore'))
    const trackerPeakScore = parseScore(form.get('trackerPeakScore'))

    if (!currentRank) {
      return fail(400, { success: false, message: 'Select your current rank.' })
    }
    if (!displayName) {
      return fail(400, { success: false, message: 'Enter the name you play under.' })
    }

    // Tracker links arrive as parallel label/url fields.
    const labels = form.getAll('trackerLabel').map((v) => String(v))
    const urls = form.getAll('trackerUrl').map((v) => String(v))
    const trackerLinks = normalizeTrackerLinks(
      urls.map((url, i) => ({ label: labels[i] ?? '', url }))
    )

    const { data: activeSeason } = await supabaseAdmin
      .from('seasons')
      .select('id')
      .eq('is_active', true)
      .maybeSingle()

    if (!activeSeason) {
      return fail(400, {
        success: false,
        message: 'Signups are closed — there is no active season right now.',
      })
    }

    const computedValue = computeSignupValue({
      current_rank: currentRank,
      peak_rank: peakRank,
      tracker_current_score: trackerCurrentScore,
      tracker_peak_score: trackerPeakScore,
    })

    const { error: upsertError } = await supabaseAdmin.from('player_signups').upsert(
      {
        profile_id: profile.id,
        season_id: activeSeason.id,
        display_name: displayName,
        discord_handle: discordHandle,
        tracker_links: trackerLinks,
        current_rank: currentRank,
        peak_rank: peakRank,
        tracker_current_score: trackerCurrentScore,
        tracker_peak_score: trackerPeakScore,
        computed_value: computedValue,
        // Resubmitting returns the signup to review.
        status: 'pending',
      },
      { onConflict: 'profile_id,season_id' }
    )

    if (upsertError) {
      console.error('Failed to save signup:', upsertError)
      return fail(500, { success: false, message: 'Failed to save your signup. Try again.' })
    }

    // Mirror the display name onto the profile when it is not set yet, so the
    // rest of the site can use it immediately.
    const updates: Record<string, unknown> = {}
    if (!profile.display_name && displayName) updates.display_name = displayName
    if (Object.keys(updates).length > 0) {
      await supabaseAdmin.from('profiles').update(updates).eq('id', profile.id)
    }

    return { success: true, message: 'Signup submitted. An admin will review it shortly.' }
  },
}
