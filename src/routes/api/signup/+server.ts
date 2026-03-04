import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request, locals }) => {
  // Legacy endpoint: player_registration is no longer used.
  void request
  void locals
  throw error(410, 'Player registration has been removed. Set your Riot ID on your player page.')
}
