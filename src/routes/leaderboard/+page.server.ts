import { supabaseAdmin } from '$lib/supabase/admin'

function getTeamLogoUrl(team: any): string | null {
  if (!team?.logo_path) return null
  return supabaseAdmin.storage.from('team-logos').getPublicUrl(team.logo_path).data.publicUrl
}

function safeInt(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

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
      rank: safeInt(entry.rank),
      points: safeInt(entry.points),
      series_played: safeInt(entry.matches_played),
      series_wins: safeInt(entry.wins),
      series_losses: safeInt(entry.losses),
      map_wins: safeInt(entry.map_wins),
      map_losses: safeInt(entry.map_losses),
      maps_played: safeInt(entry.map_wins) + safeInt(entry.map_losses),
      round_diff: safeInt(entry.round_diff),
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
