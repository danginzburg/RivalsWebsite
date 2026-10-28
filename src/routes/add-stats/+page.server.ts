import { error, redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  // Legacy route: admins are sent to its new home; everyone else gets a 404.
  if (locals.user?.role !== 'admin') throw error(404, 'Not found')

  throw redirect(303, '/admin/stats-import')
}
