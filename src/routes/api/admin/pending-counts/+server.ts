import { json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { getAdminPendingCounts } from '$lib/server/admin/pending-counts'

/** Fresh tab-badge counts, re-read by the dashboard after every review action. */
export const GET: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals.user)
  return json(await getAdminPendingCounts())
}
