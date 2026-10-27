import { error, fail, redirect, type Actions } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'
import { normalizeRiotTag } from '$lib/server/riot-id'
import { claimRelinkAfterProfileUpdate } from '$lib/server/players/claim-relink'
import {
  RiotAccountError,
  hasLinkedRiotAccount,
  linkPrimaryRiotAccount,
} from '$lib/server/players/riot-accounts'
import { identityDisplayName } from '$lib/server/players/riot-identities'
import { lookupPlayer } from '$lib/server/players/directory'

/** Only same-site paths; anything else falls back to the player page. */
function safeReturnTo(value: unknown): string | null {
  const v = String(value ?? '')
  return v.startsWith('/') && !v.startsWith('//') ? v : null
}

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.user) throw redirect(303, '/auth/login?returnTo=/account')

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, display_name_is_custom')
    .eq('auth0_sub', locals.user.sub)
    .maybeSingle()

  if (profileError) {
    const msg = String((profileError as { message?: string }).message ?? '')
    throw error(500, msg || 'Failed to load profile')
  }
  if (!profile) throw error(404, 'Profile not found')

  const returnTo = safeReturnTo(url.searchParams.get('returnTo'))

  // Once the Riot account is linked, /account is just a door to the player
  // page; `?edit` reopens the prompt to change it.
  if (!url.searchParams.has('edit') && (await hasLinkedRiotAccount(profile.id))) {
    throw redirect(303, returnTo ?? `/players/${profile.id}`)
  }

  const player = await lookupPlayer({ profileId: profile.id })
  const riotId = player?.riot_name
    ? player.riot_tag
      ? `${player.riot_name}#${player.riot_tag}`
      : player.riot_name
    : ''

  return {
    profile: {
      id: profile.id as string,
      riotId,
      // Only a name the player chose is pre-filled; a seeded Riot name is not an
      // "alternate" display name.
      displayName: profile.display_name_is_custom ? (profile.display_name ?? '') : '',
    },
    returnTo,
  }
}

export const actions: Actions = {
  default: async ({ locals, request }) => {
    if (!locals.user) throw redirect(303, '/auth/login?returnTo=/account')
    const form = await request.formData()

    const rawRiotId = String(form.get('riot_id') ?? '').trim()
    const displayName = String(form.get('display_name') ?? '')
      .trim()
      .slice(0, 40)
    const returnTo = safeReturnTo(form.get('returnTo'))
    const values = { riotId: rawRiotId, displayName }

    const hash = rawRiotId.lastIndexOf('#')
    const riotName = hash > 0 ? rawRiotId.slice(0, hash).trim() : ''
    const riotTag = hash > 0 ? normalizeRiotTag(rawRiotId.slice(hash + 1)) : null
    if (riotName.length < 3 || riotName.length > 16 || !riotTag) {
      return fail(400, {
        ...values,
        message: 'Enter your full Riot ID, e.g. Name#TAG (name 3–16 characters, tag 3–5).',
      })
    }
    if (displayName.length === 1) {
      return fail(400, { ...values, message: 'Display names need at least 2 characters.' })
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('auth0_sub', locals.user.sub)
      .maybeSingle()
    if (!profile?.id) throw error(404, 'Profile not found')

    let linked
    try {
      linked = await linkPrimaryRiotAccount({ profileId: profile.id, riotName, riotTag })
    } catch (err) {
      if (err instanceof RiotAccountError)
        return fail(err.status, { ...values, message: err.message })
      throw err
    }

    // A name an admin set before the player ever logged in stands in when they
    // leave the alternate name blank.
    const chosenName = displayName || (await identityDisplayName(linked.puuid).catch(() => null))
    if (chosenName) {
      await supabaseAdmin
        .from('profiles')
        .update({ display_name: chosenName, display_name_is_custom: true })
        .eq('id', profile.id)
    } else {
      // No alternate name: show the Riot name, as everywhere else does by default.
      await supabaseAdmin
        .from('profiles')
        .update({ display_name: linked.riotName, display_name_is_custom: false })
        .eq('id', profile.id)
    }

    try {
      await claimRelinkAfterProfileUpdate(profile.id)
    } catch (err) {
      console.warn('claimRelinkAfterProfileUpdate failed:', err)
    }

    throw redirect(303, returnTo ?? `/players/${profile.id}`)
  },
}
