import { error } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'

/** Sentinel meaning "file this against no season at all". */
export const NO_SEASON = '__none__'

/**
 * Work out which season a newly created match or team belongs to.
 *
 * Historical backfill is the reason this exists: without an explicit id every
 * insert lands on the active season, which makes it impossible to enter
 * results for a past one.
 *
 * - an explicit id is validated and used
 * - `__none__` files the row against no season
 * - omitted falls back to the active season, preserving previous behaviour
 */
export async function resolveTargetSeasonId(value: unknown): Promise<string | null> {
  const raw = typeof value === 'string' ? value.trim() : ''

  if (raw === NO_SEASON) return null

  if (raw) {
    const { data: season } = await supabaseAdmin
      .from('seasons')
      .select('id')
      .eq('id', raw)
      .maybeSingle()

    if (!season) throw error(400, 'That season does not exist')
    return season.id
  }

  const { data: activeSeason } = await supabaseAdmin
    .from('seasons')
    .select('id')
    .eq('is_active', true)
    .maybeSingle()

  return activeSeason?.id ?? null
}
