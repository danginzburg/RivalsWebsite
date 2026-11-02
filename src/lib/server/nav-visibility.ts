import { error } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { loadPublishedContent } from '$lib/server/content/site-content'
import { loadSignupSeason } from '$lib/server/signups/season'

export type NavVisibility = {
  activeSeasonKind: 'rivals' | 'external'
  signupsOpen: boolean
  hasActivePickem: boolean
  rulebookPublished: boolean
  faqPublished: boolean
}

/** Pages that can drop out of the header. Everything else in the nav is always shown. */
export type GatedNavPage =
  | 'hall-of-fame'
  | 'scrim-finder'
  | 'team-balance'
  | 'rulebook'
  | 'faq'
  | 'signup'

/** The season state the header uses to decide which tabs to show. */
export async function loadNavVisibility(): Promise<NavVisibility> {
  const { data: activeSeason } = await supabaseAdmin
    .from('seasons')
    .select('id, kind, pickem_events (status)')
    .eq('is_active', true)
    .maybeSingle()

  // External events reuse the match/stats/standings infrastructure but host
  // their rulebook / signup / FAQ elsewhere, so the Rivals-only nav tabs are
  // hidden while an external event is the active season.
  const activeSeasonKind = activeSeason?.kind === 'external' ? 'external' : 'rivals'

  // A season can take signups while another event is active, in which case the
  // Signup tab stays visible even during an external event.
  const [signupSeason, published] = await Promise.all([loadSignupSeason(), loadPublishedContent()])
  const signupsOpen = Boolean(signupSeason)

  const pickemStatus = (
    Array.isArray(activeSeason?.pickem_events)
      ? activeSeason?.pickem_events[0]
      : activeSeason?.pickem_events
  )?.status as string | undefined
  const hasActivePickem = Boolean(pickemStatus && pickemStatus !== 'draft')

  return {
    activeSeasonKind,
    signupsOpen,
    hasActivePickem,
    rulebookPublished: published.rulebook,
    faqPublished: published.faq,
  }
}

/** Mirrors the header's nav list in Header.svelte — keep the two in sync. */
export function isNavPageVisible(page: GatedNavPage, vis: NavVisibility): boolean {
  const external = vis.activeSeasonKind === 'external'
  switch (page) {
    case 'hall-of-fame':
    case 'scrim-finder':
      return false
    case 'team-balance':
      return !external
    case 'rulebook':
      return !external && vis.rulebookPublished
    case 'faq':
      return !external && vis.faqPublished
    case 'signup':
      return !external || vis.signupsOpen
  }
}

/** 404 a page that isn't in the header, unless the viewer is an admin. */
export async function requireNavPage(locals: App.Locals, page: GatedNavPage): Promise<void> {
  if (locals.user?.role === 'admin') return
  if (!isNavPageVisible(page, await loadNavVisibility())) throw error(404, 'Not found')
}
