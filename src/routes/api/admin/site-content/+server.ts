import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import {
  SiteContentConflictError,
  loadSiteContent,
  saveSiteContent,
} from '$lib/server/content/site-content'
import { isSiteContentKey, normalizeSiteContent, validateSiteContent } from '$lib/content/documents'

export const GET: RequestHandler = async ({ locals, url }) => {
  await requireAdmin(locals.user)

  const key = url.searchParams.get('key')
  if (!isSiteContentKey(key)) throw error(400, 'Unknown content key')

  return json(await loadSiteContent(key))
}

/** Replaces a whole document. Body: { key, document, expectedUpdatedAt }. */
export const PUT: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const key = body.key
  if (!isSiteContentKey(key)) throw error(400, 'Unknown content key')

  const problems = validateSiteContent(key, normalizeSiteContent(key, body.document))
  if (problems.length > 0) throw error(400, problems[0])

  const expectedUpdatedAt =
    typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : null

  try {
    const saved = await saveSiteContent(key, body.document, admin.id, expectedUpdatedAt)
    return json({ success: true, ...saved })
  } catch (err) {
    if (err instanceof SiteContentConflictError) throw error(409, err.message)
    console.error('[site-content] save failed', err)
    throw error(500, 'Failed to save content')
  }
}
