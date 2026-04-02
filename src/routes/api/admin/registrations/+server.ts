import { error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals }) => {
  void locals
  throw error(410, 'Registration endpoints have been removed')
}
