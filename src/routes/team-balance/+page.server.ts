import { supabaseAdmin } from '$lib/supabase/admin'
import { effectiveValue } from '$lib/server/signups'

/**
 * Players with an approved signup carry a rating from the signup formula.
 * The calculator uses that value in place of the flat rank lookup.
 */
export const load = async () => {
  const { data: activeSeason } = await supabaseAdmin
    .from('seasons')
    .select('id')
    .eq('is_active', true)
    .maybeSingle()

  let query = supabaseAdmin
    .from('player_signups')
    .select('profile_id, display_name, current_rank, computed_value, manual_value_override')
    .eq('status', 'approved')

  if (activeSeason) query = query.eq('season_id', activeSeason.id)

  const { data: signups, error: signupsError } = await query

  if (signupsError) {
    // The table may not exist yet if migrations have not been applied.
    console.error('Failed to load rated players:', signupsError)
    return { ratedPlayers: [] }
  }

  const rows = signups ?? []
  if (rows.length === 0) return { ratedPlayers: [] }

  const profileIds = Array.from(new Set(rows.map((r) => r.profile_id)))
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, riot_id_base')
    .in('id', profileIds)

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]))

  const ratedPlayers = rows
    .map((row) => {
      const profile = profileById.get(row.profile_id)
      const value = effectiveValue(row)
      return {
        profileId: row.profile_id,
        name: row.display_name ?? profile?.riot_id_base ?? profile?.display_name ?? 'Player',
        rank: row.current_rank ?? null,
        value,
        isManual: row.manual_value_override != null,
      }
    })
    // A signup without a rating cannot help the calculator.
    .filter((p): p is typeof p & { value: number } => p.value != null)
    .sort((a, b) => a.name.localeCompare(b.name))

  return { ratedPlayers }
}
