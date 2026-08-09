import { redirect } from '@sveltejs/kit'

/** The matches feed now lives at the site root. */
export const load = async () => {
  throw redirect(301, '/')
}
