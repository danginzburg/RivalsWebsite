import { supabaseAdmin } from '$lib/supabase/admin'

/**
 * Player ratings — the input to the signup score bonus.
 *
 * Loaded once from an externally calculated sheet; this module is the seam to
 * swap for an internal calculation later. Ratings are matched to a signup by
 * its Riot name, lowercased.
 */

export function ratingNameKey(name: string | null | undefined): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
}

/** Ratings for the given player names, keyed by `ratingNameKey`. */
export async function loadRatingsByName(
  names: Array<string | null | undefined>
): Promise<Map<string, number>> {
  const keys = [...new Set(names.map(ratingNameKey).filter(Boolean))]
  const ratings = new Map<string, number>()
  if (keys.length === 0) return ratings

  // Chunked so a large signup list stays well under URL length limits.
  for (let i = 0; i < keys.length; i += 200) {
    const { data, error } = await supabaseAdmin
      .from('player_ratings')
      .select('name_key, rating')
      .in('name_key', keys.slice(i, i + 200))
    if (error) throw new Error(error.message)
    for (const row of data ?? []) ratings.set(row.name_key, Number(row.rating))
  }

  return ratings
}

export async function loadRatingFor(name: string | null | undefined): Promise<number | null> {
  const ratings = await loadRatingsByName([name])
  return ratings.get(ratingNameKey(name)) ?? null
}
