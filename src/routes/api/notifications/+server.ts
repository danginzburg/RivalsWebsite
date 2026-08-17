import { json, type RequestHandler } from '@sveltejs/kit'

import { getViewerProfileId } from '$lib/server/auth/viewer'
import { countUnread, listNotifications, markAllRead, markRead } from '$lib/server/notifications'

export const GET: RequestHandler = async ({ locals }) => {
  const profileId = await getViewerProfileId(locals.user)
  if (!profileId) return json({ notifications: [], unread: 0 })

  const [notifications, unread] = await Promise.all([
    listNotifications(profileId),
    countUnread(profileId),
  ])

  return json({ notifications, unread })
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
