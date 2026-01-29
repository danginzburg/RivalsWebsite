import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { clearSessionCookie } from '$lib/server/auth/session'

export const GET: RequestHandler = async ({ cookies }) => {
  await clearSessionCookie(cookies)
  return json({ success: true })
}
