import { redirect } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { loadSiteContent } from '$lib/server/content/site-content'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    throw redirect(303, '/auth/login?returnTo=/admin/content')
  }
  await requireAdmin(locals.user)

  const [rulebook, faq] = await Promise.all([loadSiteContent('rulebook'), loadSiteContent('faq')])
  return { rulebook, faq }
}
