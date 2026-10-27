import { redirect, fail } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { requireProfile } from '$lib/server/auth/profile'
import { normalizeRiotBase, isValidRiotBase, normalizeRiotTag } from '$lib/server/riot-id'
import {
  effectiveValue,
  normalizeDiscordHandle,
  normalizeTrackerLinks,
  MAX_TRACKER_LINKS,
} from '$lib/server/signups'
import { loadSignupSeason } from '$lib/server/signups/season'
import { riotIdOwnedByOther, upsertPrimaryRiotAccount } from '$lib/server/players/riot-accounts'
import { lookupPlayer } from '$lib/server/players/directory'
import { withSignupRiotIds } from '$lib/server/signups/riot-ids'

const SIGNUP_COLUMNS = `
  id,
  profile_id,
  discord_handle,
  tracker_links,
  current_rank,
  peak_rank,
  computed_value,
  manual_value_override,
  manual_adjustment,
  status,
  admin_notes,
  created_at,
  updated_at
`

async function loadSignup(profileId: string, seasonId: string) {
  const { data } = await supabaseAdmin
    .from('player_signups')
    .select(SIGNUP_COLUMNS)
    .eq('profile_id', profileId)
    .eq('season_id', seasonId)
    .maybeSingle()
  return data ? (await withSignupRiotIds([data]))[0] : null
}

export const load = async ({ locals }: { locals: App.Locals }) => {
  /**
   * Signed-out visitors get the page, not a bounce to Discord. Sending them
   * straight into an OAuth redirect means the first thing a prospective player
   * sees is a consent screen for a site they have not looked at yet — the page
   * asks them to sign in over the top of the form instead.
   */
  if (!locals.user) {
    return {
      signedIn: false,
      profile: {
        id: null,
        display_name: null,
        riot_name: null,
        riot_tag: null,
        discord_handle: null,
      },
      signupSeason: await loadSignupSeason(),
      signup: null,
      maxTrackerLinks: MAX_TRACKER_LINKS,
    }
  }

  const profile = await requireProfile(locals.user)
  const signupSeason = await loadSignupSeason()

  // The Riot ID and Discord details the form pre-fills.
  const player = await lookupPlayer({ profileId: profile.id })

  const existing = signupSeason ? await loadSignup(profile.id, signupSeason.id) : null

  return {
    signedIn: true,
    profile: {
      id: profile.id,
      display_name: profile.display_name ?? null,
      riot_name: player?.riot_name ?? null,
      riot_tag: player?.riot_tag ?? null,
      // The handle from their last signup first, then their Discord login's.
      discord_handle:
        player?.latest_signup_discord_handle ??
        player?.discord_username ??
        locals.user.discord_username ??
        null,
    },
    signupSeason,
    // The value shown to the player includes any admin adjustment.
    signup: existing && { ...existing, assigned_value: effectiveValue(existing) },
    maxTrackerLinks: MAX_TRACKER_LINKS,
  }
}

export const actions = {
  /**
   * Create or update the signed-in player's signup for the season currently taking signups.
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

    // Name and tag arrive separately; every Riot API needs the pair.
    const riotTag = normalizeRiotTag(form.get('riotTag'))
    if (!riotTag) {
      return fail(400, {
        success: false,
        message: 'Enter your Riot tagline — the part after the # (3–5 characters).',
      })
    }

    const discordHandle = normalizeDiscordHandle(form.get('discordHandle'))
    if (!discordHandle) {
      return fail(400, {
        success: false,
        message: 'Enter your Discord handle so captains and admins can reach you.',
      })
    }

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

    const signupSeason = await loadSignupSeason()
    if (!signupSeason) {
      return fail(400, {
        success: false,
        message: 'Signups are closed right now.',
      })
    }

    // One signup per player per season. An approved signup is locked so a
    // player cannot quietly change their details after being rated.
    const existing = await loadSignup(profile.id, signupSeason.id)
    if (existing?.status === 'approved') {
      return fail(409, {
        success: false,
        message:
          'Your signup has been approved and can no longer be edited. Contact an admin if something needs changing.',
      })
    }

    // The Riot ID must not already belong to someone else.
    if (await riotIdOwnedByOther(riotId, riotTag, profile.id)) {
      return fail(409, {
        success: false,
        message: 'That Riot ID is already linked to another account.',
      })
    }

    // The Riot ID is stored once, as the player's primary Riot account (PUUID
    // captured best-effort); the signup reads it from there.
    try {
      await upsertPrimaryRiotAccount({ profileId: profile.id, riotName: riotId, riotTag })
    } catch (err) {
      console.error('Failed to save primary Riot account on signup:', err)
      return fail(500, { success: false, message: 'Failed to save your Riot ID. Try again.' })
    }

    const payload = {
      profile_id: profile.id,
      season_id: signupSeason.id,
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

    // Seed the chosen display name from the Riot name, but only while the player
    // has not set one of their own — the flag flips when they edit it directly.
    await supabaseAdmin
      .from('profiles')
      .update({ display_name: riotId })
      .eq('id', profile.id)
      .eq('display_name_is_custom', false)

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

    const signupSeason = await loadSignupSeason()
    if (!signupSeason) {
      return fail(400, { success: false, message: 'Signups are closed right now.' })
    }

    const existing = await loadSignup(profile.id, signupSeason.id)
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
      .eq('season_id', signupSeason.id)

    if (deleteError) {
      console.error('Failed to withdraw signup:', deleteError)
      return fail(500, { success: false, message: 'Failed to withdraw your signup. Try again.' })
    }

    return { success: true, message: 'Signup withdrawn.' }
  },
}
