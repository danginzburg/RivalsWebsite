import { supabaseAdmin } from '$lib/supabase/admin'
import { fetchAllRowsResult } from '$lib/server/supabase/fetch-all'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import type { MatchStreamRow } from '$lib/server/db-rows'
import { isUnreachableError } from '$lib/server/supabase/unreachable'
import { getStandingsRanksForSeasons } from '$lib/server/leaderboard/ranks'
import { loadRecentComments } from '$lib/server/comments/recent'

export const load = async ({ locals }: { locals: App.Locals }) => {
  const isAdmin = locals.user?.role === 'admin'
  const { data: matches, error: matchesError } = await fetchAllRowsResult(() =>
    supabaseAdmin
      .from('matches')
      .select(
        `
      id,
      season_id,
      status,
      approval_status,
      best_of,
      scheduled_at,
      started_at,
      ended_at,
      team_a_score,
      team_b_score,
      metadata,
      team_a:teams!matches_team_a_id_fkey (id, name, tag, logo_path),
      team_b:teams!matches_team_b_id_fkey (id, name, tag, logo_path)
    `
      )
      .eq('approval_status', 'approved')
      // A cancelled match never happened; it stays on record for admins only.
      .neq('status', 'cancelled')
      .order('scheduled_at', { ascending: true, nullsFirst: false })
      .order('id')
  )

  if (matchesError) {
    console.error('Failed to load matches:', matchesError)
  }

  // An unreachable database must not render as "no matches yet" — that reads
  // as an empty league rather than an outage.
  const loadFailed = Boolean(matchesError)
  const unreachable = isUnreachableError(matchesError)

  const matchIds = (matches ?? []).map((m) => m.id)
  let streamsByMatch: Record<string, MatchStreamRow[]> = {}

  // External events (Shitter League) are hidden on the client by default.
  const seasonIds = [...new Set((matches ?? []).map((m) => m.season_id).filter(Boolean))]
  const externalSeasonIds = new Set<string>()
  if (seasonIds.length > 0) {
    const { data: seasons } = await supabaseAdmin
      .from('seasons')
      .select('id, kind')
      .in('id', seasonIds)
    for (const season of seasons ?? []) {
      if (season.kind === 'external') externalSeasonIds.add(season.id)
    }
  }

  if (matchIds.length > 0) {
    const { data: streams } = await supabaseAdmin
      .from('match_streams')
      .select('id, match_id, platform, stream_url, is_primary, status, metadata')
      .in('match_id', matchIds)
      .order('is_primary', { ascending: false })

    streamsByMatch = ((streams ?? []) as MatchStreamRow[]).reduce(
      (acc, stream) => {
        if (!acc[stream.match_id]) acc[stream.match_id] = []
        acc[stream.match_id].push(stream)
        return acc
      },
      {} as Record<string, MatchStreamRow[]>
    )
  }

  const normalized = (matches ?? []).map((match) => ({
    ...match,
    streams: streamsByMatch[match.id] ?? [],
    external: externalSeasonIds.has(match.season_id),
    designation: (match.metadata as Record<string, unknown> | null)?.designation ?? null,
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

  // Ranks span every season represented in the feed, so a historical match
  // still shows the standings from its own season.
  const [seeds, recentComments] = await Promise.all([
    getStandingsRanksForSeasons((matches ?? []).map((m) => m.season_id)),
    loadRecentComments(8),
  ])

  return {
    matches: normalized,
    seeds,
    recentComments,
    loadFailed,
    unreachable,
    viewer: { isAdmin },
  }
}
