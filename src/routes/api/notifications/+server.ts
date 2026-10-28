import { json, type RequestHandler } from '@sveltejs/kit'

import { getViewerProfileId } from '$lib/server/auth/viewer'
import {
  clearAllNotifications,
  clearNotifications,
  countUnread,
  listNotifications,
  markAllRead,
  markRead,
} from '$lib/server/notifications'
import { getAdminQueue } from '$lib/server/admin/pending-counts'

export const GET: RequestHandler = async ({ locals }) => {
  const profileId = await getViewerProfileId(locals.user)
  if (!profileId) return json({ notifications: [], unread: 0, adminQueue: [] })

  // Admins also get the live review queues (see getAdminQueue).
  const [notifications, unread, adminQueue] = await Promise.all([
    listNotifications(profileId),
    countUnread(profileId),
    locals.user?.role === 'admin' ? getAdminQueue() : Promise.resolve([]),
  ])

  return json({ notifications, unread, adminQueue })
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const profileId = await getViewerProfileId(locals.user)
  if (!profileId) return json({ unread: 0 })

  const body = await request.json().catch(() => ({}))

  if (body.all === true) {
    await markAllRead(profileId)
  } else if (Array.isArray(body.ids)) {
    const ids = body.ids.filter((id: unknown): id is string => typeof id === 'string')
    await markRead(profileId, ids)
  }

  return json({ unread: await countUnread(profileId) })
}

export const DELETE: RequestHandler = async ({ request, locals }) => {
  const profileId = await getViewerProfileId(locals.user)
  if (!profileId) return json({ unread: 0 })

  const body = await request.json().catch(() => ({}))

  if (body.all === true) {
    await clearAllNotifications(profileId)
  } else if (Array.isArray(body.ids)) {
    const ids = body.ids.filter((id: unknown): id is string => typeof id === 'string')
    await clearNotifications(profileId, ids)
  }

  return json({ unread: await countUnread(profileId) })
}
