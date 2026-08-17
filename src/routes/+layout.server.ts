import type { LayoutServerLoad } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'
import { getViewerProfileId } from '$lib/server/auth/viewer'
import { countUnread } from '$lib/server/notifications'

export const load: LayoutServerLoad = async ({ locals }) => {
  const { data: activeSeason } = await supabaseAdmin
    .from('seasons')
    .select('id, pickem_events (status)')
    .eq('is_active', true)
    .maybeSingle()

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
    unreadNotifications,
  }
}
