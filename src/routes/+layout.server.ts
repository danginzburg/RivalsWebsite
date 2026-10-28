import type { LayoutServerLoad } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'
import { getViewerProfileId } from '$lib/server/auth/viewer'
import { countUnread } from '$lib/server/notifications'
import { getAdminQueue } from '$lib/server/admin/pending-counts'
import { loadSignupSeason } from '$lib/server/signups/season'

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

  // A season can take signups while another event is active, in which case the
  // Signup tab stays visible even during an external event.
  const signupsOpen = Boolean(await loadSignupSeason())

  const pickemStatus = (
    Array.isArray(activeSeason?.pickem_events)
      ? activeSeason?.pickem_events[0]
      : activeSeason?.pickem_events
  )?.status as string | undefined
  const hasActivePickem = Boolean(pickemStatus && pickemStatus !== 'draft')

  // Seed the header bell so the unread count is correct on first paint.
  const viewerProfileId = locals.user ? await getViewerProfileId(locals.user) : null
  const [unreadNotifications, adminQueue] = await Promise.all([
    viewerProfileId ? countUnread(viewerProfileId) : 0,
    viewerProfileId && locals.user?.role === 'admin' ? getAdminQueue() : [],
  ])

  return {
    user: locals.user,
    hasActivePickem,
    activeSeasonKind,
    signupsOpen,
    unreadNotifications,
    adminQueue,
  }
}
