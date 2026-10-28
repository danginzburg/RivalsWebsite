import { requireNavPage } from '$lib/server/nav-visibility'
import { loadSiteContent } from '$lib/server/content/site-content'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  await requireNavPage(locals, 'faq')
  const { document } = await loadSiteContent('faq')
  return { faq: document }
}
