import { supabaseAdmin } from '$lib/supabase/admin'
import { getTeamLogoUrl } from '$lib/server/teams/logo'

export const load = async () => {
  const { data: matches, error: matchesError } = await supabaseAdmin
    .from('matches')
    .select(
      `
      id,
      status,
      approval_status,
      best_of,
      scheduled_at,
      started_at,
      ended_at,
      team_a_score,
      team_b_score,
      team_a:teams!matches_team_a_id_fkey (id, name, tag, logo_path),
      team_b:teams!matches_team_b_id_fkey (id, name, tag, logo_path)
    `
    )
    .eq('approval_status', 'approved')
    .order('scheduled_at', { ascending: true, nullsFirst: false })

  if (matchesError) {
    console.error('Failed to load matches:', matchesError)
  }

  const matchIds = (matches ?? []).map((m) => m.id)
  let streamsByMatch: Record<string, any[]> = {}

  if (matchIds.length > 0) {
    const { data: streams } = await supabaseAdmin
      .from('match_streams')
      .select('id, match_id, platform, stream_url, is_primary, status, metadata')
      .in('match_id', matchIds)
      .order('is_primary', { ascending: false })

    streamsByMatch = (streams ?? []).reduce(
      (acc, stream) => {
        if (!acc[stream.match_id]) acc[stream.match_id] = []
        acc[stream.match_id].push(stream)
        return acc
      },
      {} as Record<string, any[]>
    )
  }

  const normalized = (matches ?? []).map((match) => ({
    ...match,
    streams: streamsByMatch[match.id] ?? [],
    team_a: match.team_a
      ? {
          ...(Array.isArray(match.team_a) ? match.team_a[0] : match.team_a),
          logo_url: getTeamLogoUrl(Array.isArray(match.team_a) ? match.team_a[0] : match.team_a),
        }
      : null,
    team_b: match.team_b
      ? {
          ...(Array.isArray(match.team_b) ? match.team_b[0] : match.team_b),
          logo_url: getTeamLogoUrl(Array.isArray(match.team_b) ? match.team_b[0] : match.team_b),
        }
      : null,
  }))

  return { matches: normalized }
}
