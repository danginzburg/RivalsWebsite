import { supabaseAdmin } from '$lib/supabase/admin'
import { safeNumber } from '$lib/server/parse'
import { getTeamLogoUrl } from '$lib/server/teams/logo'

export const load = async () => {
  const { data: batch } = await supabaseAdmin
    .from('stat_import_batches')
    .select('id, display_name, source_filename, created_at, metadata')
    .filter('metadata->>import_type', 'eq', 'leaderboard_entries')
    .eq('status', 'applied')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!batch) return { rows: [], batch: null }

  const { data: entries, error: entriesError } = await supabaseAdmin
    .from('leaderboard_entries')
    .select(
      `
      id,
      rank,
      points,
      matches_played,
      wins,
      losses,
      map_wins,
      map_losses,
      round_diff,
      split,
      as_of_date,
      teams:teams!leaderboard_entries_team_id_fkey (id, name, tag, logo_path)
    `
    )
    .eq('import_batch_id', batch.id)
    .order('rank', { ascending: true, nullsFirst: false })
    .order('points', { ascending: false })

  if (entriesError) return { rows: [], batch: null }

  const rows = (entries ?? []).map((entry: any) => {
    const team = Array.isArray(entry.teams) ? entry.teams[0] : entry.teams
    return {
      id: entry.id,
      rank: safeNumber(entry.rank),
      points: safeNumber(entry.points),
      series_played: safeNumber(entry.matches_played),
      series_wins: safeNumber(entry.wins),
      series_losses: safeNumber(entry.losses),
      map_wins: safeNumber(entry.map_wins),
      map_losses: safeNumber(entry.map_losses),
      maps_played: safeNumber(entry.map_wins) + safeNumber(entry.map_losses),
      round_diff: safeNumber(entry.round_diff),
      team: team
        ? {
            id: team.id,
            name: team.name,
            tag: team.tag ?? null,
            logo_url: getTeamLogoUrl(team),
          }
        : null,
    }
  })

  return {
    rows,
    batch: {
      display_name: batch.metadata?.display_name ?? batch.display_name ?? batch.source_filename,
      created_at: batch.created_at,
      as_of_date: batch.metadata?.as_of_date ?? null,
      split: batch.metadata?.split ?? 'main',
    },
  }
}
