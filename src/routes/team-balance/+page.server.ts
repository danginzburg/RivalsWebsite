import { requireNavPage } from '$lib/server/nav-visibility'
import { supabaseAdmin } from '$lib/supabase/admin'
import { effectiveValue } from '$lib/server/signups'
import { loadSignupSeason } from '$lib/server/signups/season'
import { loadPlayerDirectory } from '$lib/server/players/directory'

/**
 * Players with an approved signup carry a rating from the signup formula.
 * The calculator uses that value in place of the flat rank lookup.
 *
 * Rosters are built for the season taking signups, which may be the next
 * event rather than the active one.
 */
export const load = async ({ locals }: { locals: App.Locals }) => {
  await requireNavPage(locals, 'team-balance')
  const season = await loadSignupSeason()
  if (!season) return { season: null, ratedPlayers: [] }

  const { data: signups, error: signupsError } = await supabaseAdmin
    .from('player_signups')
    .select(
      'profile_id, display_name, current_rank, computed_value, manual_value_override, manual_adjustment'
    )
    .eq('status', 'approved')
    .eq('season_id', season.id)

  if (signupsError) {
    // The table may not exist yet if migrations have not been applied.
    console.error('Failed to load rated players:', signupsError)
    return { season, ratedPlayers: [] }
  }

  const rows = signups ?? []
  if (rows.length === 0) return { season, ratedPlayers: [] }

  const directory = await loadPlayerDirectory(rows.map((r) => r.profile_id)).catch((err) => {
    console.error('Failed to load player directory for calculator:', err)
    return new Map()
  })

  const ratedPlayers = rows
    .map((row) => {
      const entry = directory.get(row.profile_id)
      const value = effectiveValue(row)
      const riotId = entry?.riot_name
        ? entry.riot_tag
          ? `${entry.riot_name}#${entry.riot_tag}`
          : entry.riot_name
        : null
      return {
        profileId: row.profile_id,
        name: row.display_name ?? entry?.display_name ?? riotId ?? 'Player',
        riotId,
        /** Every approved Riot ID, so a player can be found by an alt or old name. */
        riotIds: (entry?.riot_ids ?? []) as string[],
        rank: row.current_rank ?? null,
        value,
        isManual: row.manual_value_override != null || Number(row.manual_adjustment ?? 0) !== 0,
      }
    })
    // A signup without a rating cannot help the calculator.
    .filter((p): p is typeof p & { value: number } => p.value != null)
    .sort((a, b) => a.name.localeCompare(b.name))

  return { season, ratedPlayers }
}
