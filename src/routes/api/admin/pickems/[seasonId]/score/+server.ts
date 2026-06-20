import { error, type RequestHandler } from '@sveltejs/kit'

export const POST: RequestHandler = async () => {
  throw error(410, 'Legacy pickems scoring is disabled')
}
