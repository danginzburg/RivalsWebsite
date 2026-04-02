import { error, type RequestHandler } from '@sveltejs/kit'

// Legacy endpoint; kept to avoid breaking older clients.

export const PATCH: RequestHandler = async ({ locals, request }) => {
  void locals
  void request
  throw error(410, 'Player rank management has been removed')
}
