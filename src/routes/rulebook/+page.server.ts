import { requireNavPage } from '$lib/server/nav-visibility'
import { loadSiteContent } from '$lib/server/content/site-content'
import { DEFAULT_RULEBOOK_UPDATED } from '$lib/content/documents'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  await requireNavPage(locals, 'rulebook')
  const { document, updatedAt } = await loadSiteContent('rulebook')
  return {
    rulebook: document,
    updatedOn: updatedAt ? updatedAt.slice(0, 10) : DEFAULT_RULEBOOK_UPDATED,
  }
}
