import { error, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'

export const POST: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals.user)
  throw error(501, 'Pickem batch scoring is not enabled.')
}
