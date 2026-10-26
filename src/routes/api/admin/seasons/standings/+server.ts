import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { publicDataCache } from '$lib/server/cache'
import { sanitizeStandingsConfig } from '$lib/seasons/standingsZones'

/**
 * Save a season's standings zones and stage (`seasons.metadata.standings`).
 * Edited inline from the leaderboard, so it merges onto the existing metadata
 * rather than going through the full season PATCH.
 */
export const PUT: RequestHandler = async ({ locals, request }) => {
  await requireAdmin(locals.user)

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const seasonId = typeof body?.seasonId === 'string' ? body.seasonId.trim() : ''
  if (!seasonId) throw error(400, 'seasonId is required')

  const { data: current, error: loadError } = await supabaseAdmin
    .from('seasons')
    .select('metadata')
    .eq('id', seasonId)
    .maybeSingle()
  if (loadError) throw error(500, 'Failed to load season')
  if (!current) throw error(404, 'Season not found')

  const existing =
    current.metadata && typeof current.metadata === 'object'
      ? (current.metadata as Record<string, unknown>)
      : {}
  const standings = sanitizeStandingsConfig(body?.config)

  const { error: updateError } = await supabaseAdmin
    .from('seasons')
    .update({ metadata: { ...existing, standings } })
    .eq('id', seasonId)
  if (updateError) throw error(500, 'Failed to save standings zones')

  publicDataCache.delete('leaderboard:standings')

  return json({ success: true, standings })
}
