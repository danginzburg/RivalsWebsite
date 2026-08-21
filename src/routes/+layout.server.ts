import type { LayoutServerLoad } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'
import { getViewerProfileId } from '$lib/server/auth/viewer'
import { countUnread } from '$lib/server/notifications'

export const load: LayoutServerLoad = async ({ locals }) => {
  const { data: activeSeason } = await supabaseAdmin
    .from('seasons')
    .select('id, kind, pickem_events (status)')
    .eq('is_active', true)
    .maybeSingle()

  // External events reuse the match/stats/standings infrastructure but host
  // their rulebook / signup / FAQ elsewhere, so the Rivals-only nav tabs are
  // hidden while an external event is the active season.
  const activeSeasonKind = activeSeason?.kind === 'external' ? 'external' : 'rivals'

  const pickemStatus = (
    Array.isArray(activeSeason?.pickem_events)
      ? activeSeason?.pickem_events[0]
      : activeSeason?.pickem_events
  )?.status as string | undefined
  const hasActivePickem = Boolean(pickemStatus && pickemStatus !== 'draft')

  // Seed the header bell so the unread count is correct on first paint.
  const viewerProfileId = locals.user ? await getViewerProfileId(locals.user) : null
  const unreadNotifications = viewerProfileId ? await countUnread(viewerProfileId) : 0

  return {
    user: locals.user,
    hasActivePickem,
    activeSeasonKind,
    unreadNotifications,
  }
}
