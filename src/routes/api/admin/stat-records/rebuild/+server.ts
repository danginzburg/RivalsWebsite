import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { rebuildStatRecords } from '$lib/server/records/rebuild'

/**
 * Records rebuild on every match import or edit; this is the manual fallback
 * for after the migration is first applied or a rebuild failed.
 */
export const POST: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals.user)

  try {
    const { recordCount } = await rebuildStatRecords()
    return json({ success: true, recordCount })
  } catch (err) {
    console.error('Manual stat record rebuild failed:', err)
    throw error(500, 'Failed to rebuild stat records')
  }
}
