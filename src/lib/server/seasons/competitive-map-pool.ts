import { supabaseAdmin } from '$lib/supabase/admin'
import { fetchCompetitiveMapRotation } from '$lib/server/riot/henrik'
import { mergeRotationIntoPool, resolveMapPool, resolveMapPoolMode } from '$lib/seasons/mapPool'

/**
 * Folds the live ranked rotation into every season whose map pool follows it.
 * Only maps are added — never removed — so the pool ends up as every map that
 * was in rotation at some point while the season ran.
 *
 * A season stops collecting maps once its end date has passed, so a finished
 * season's pool isn't padded with maps added after it ended. Passing
 * `seasonIds` syncs just those seasons, whatever their dates (used right after
 * an admin switches a season to the competitive pool).
 */
export async function syncCompetitiveMapPools(
  options: { seasonIds?: string[] } = {}
): Promise<{ updated: string[]; rotation: string[] }> {
  let query = supabaseAdmin.from('seasons').select('id, ends_on, metadata')
  if (options.seasonIds) {
    if (options.seasonIds.length === 0) return { updated: [], rotation: [] }
    query = query.in('id', options.seasonIds)
  }
  const { data: seasons, error } = await query
  if (error) throw new Error(`Failed to load seasons: ${error.message}`)

  const today = new Date().toISOString().slice(0, 10)
  const targets = (seasons ?? []).filter((season) => {
    const metadata = season.metadata as Record<string, unknown> | null
    if (resolveMapPoolMode(metadata) !== 'competitive') return false
    if (options.seasonIds) return true
    return !season.ends_on || String(season.ends_on) >= today
  })
  if (targets.length === 0) return { updated: [], rotation: [] }

  const rotation = await fetchCompetitiveMapRotation()
  const updated: string[] = []

  for (const season of targets) {
    const metadata = (season.metadata as Record<string, unknown> | null) ?? {}
    const current = resolveMapPool(metadata)
    const next = mergeRotationIntoPool(current, rotation)
    if (next.length === current.length) continue

    const { error: updateError } = await supabaseAdmin
      .from('seasons')
      .update({ metadata: { ...metadata, map_pool: next } })
      .eq('id', season.id)
    if (updateError) {
      console.error(`Map pool sync failed for season ${season.id}:`, updateError)
      continue
    }
    updated.push(season.id as string)
  }

  return { updated, rotation }
}
