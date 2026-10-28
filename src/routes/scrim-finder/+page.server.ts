import { requireNavPage } from '$lib/server/nav-visibility'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  await requireNavPage(locals, 'scrim-finder')
}
