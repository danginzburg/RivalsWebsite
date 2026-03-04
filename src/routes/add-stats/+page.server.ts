import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  // Legacy route: keep working but redirect to Admin.
  if (!locals.user) {
    throw redirect(303, '/auth/login?returnTo=/admin/stats-import')
  }

  throw redirect(303, '/admin/stats-import')
}
