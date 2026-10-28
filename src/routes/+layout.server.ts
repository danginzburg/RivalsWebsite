import type { LayoutServerLoad } from './$types'
import { getViewerProfileId } from '$lib/server/auth/viewer'
import { countUnread } from '$lib/server/notifications'
import { getAdminQueue } from '$lib/server/admin/pending-counts'
import { loadNavVisibility } from '$lib/server/nav-visibility'

export const load: LayoutServerLoad = async ({ locals }) => {
  const { activeSeasonKind, signupsOpen, hasActivePickem } = await loadNavVisibility()

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
