import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async () => {
  // Sign-up / registration removed — do not expose registration flows.
  return { existingRegistration: null, canUpdate: false }
}
