import { error, redirect } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { MATCH_REPORT_SELECT, type MatchReportRow } from '$lib/server/matches/reports'

/** How far back a scheduled match still counts as "recent" for the picker. */
const RECENT_WINDOW_MS = 21 * 24 * 60 * 60_000
/** Matches starting soon are offered too — a series can start a little early. */
const UPCOMING_WINDOW_MS = 12 * 60 * 60_000

const TARGET_MATCH_SELECT = `
  id, status, stage, season_id, scheduled_at, best_of,
  team_a:teams!matches_team_a_id_fkey (id, name, tag),
  team_b:teams!matches_team_b_id_fkey (id, name, tag)
`

type TeamRef = { id: string; name: string; tag: string | null }
type TargetMatchQueryRow = {
  id: string
  status: string | null
  stage: string | null
  season_id: string | null
  scheduled_at: string | null
  best_of: number | null
  team_a: TeamRef | TeamRef[] | null
  team_b: TeamRef | TeamRef[] | null
}

function one(team: TeamRef | TeamRef[] | null): TeamRef | null {
  return Array.isArray(team) ? (team[0] ?? null) : team
}

/**
 * Existing matches an import can be aimed at: anything live, plus anything
 * scheduled recently (or about to start) that has no map stats yet. A match
 * named in the URL (`?match=`) is always included, so the link from a match's
 * own stats page works even outside that window.
 */
async function loadTargetMatches(requestedId: string | null) {
  const now = Date.now()
  const from = new Date(now - RECENT_WINDOW_MS).toISOString()
  const to = new Date(now + UPCOMING_WINDOW_MS).toISOString()

  const [{ data: windowed, error: windowedError }, requested] = await Promise.all([
    supabaseAdmin
      .from('matches')
      .select(TARGET_MATCH_SELECT)
      .neq('status', 'cancelled')
      .not('team_a_id', 'is', null)
      .not('team_b_id', 'is', null)
      .or(`status.eq.live,and(scheduled_at.gte.${from},scheduled_at.lte.${to})`)
      .order('scheduled_at', { ascending: false })
      .limit(100),
    requestedId && UUID_RE.test(requestedId)
      ? supabaseAdmin
          .from('matches')
          .select(TARGET_MATCH_SELECT)
          .eq('id', requestedId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  if (windowedError) throw error(500, 'Failed to load recent matches')

  const rows = (windowed ?? []) as unknown as TargetMatchQueryRow[]
  const requestedRow = requested.data as unknown as TargetMatchQueryRow | null
  if (requestedRow && !rows.some((row) => row.id === requestedRow.id)) rows.unshift(requestedRow)
  if (rows.length === 0) return []

  const { data: mapRows, error: mapsError } = await supabaseAdmin
    .from('match_maps')
    .select('match_id')
    .in(
      'match_id',
      rows.map((row) => row.id)
    )
  if (mapsError) throw error(500, 'Failed to check imported maps')
  const imported = new Set((mapRows ?? []).map((row) => String(row.match_id)))

  return rows
    .filter((row) => row.id === requestedRow?.id || !imported.has(row.id))
    .map((row) => ({
      id: row.id,
      status: row.status,
      stage: row.stage,
      seasonId: row.season_id,
      scheduledAt: row.scheduled_at,
      bestOf: row.best_of,
      teamA: one(row.team_a),
      teamB: one(row.team_b),
      hasStats: imported.has(row.id),
    }))
    .sort((a, b) => {
      // Live first, then most recent.
      const liveA = a.status === 'live' ? 0 : 1
      const liveB = b.status === 'live' ? 0 : 1
      if (liveA !== liveB) return liveA - liveB
      return Date.parse(b.scheduledAt ?? '') - Date.parse(a.scheduledAt ?? '') || 0
    })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Captain result submissions: everything still waiting on an admin, plus the
 * latest handful that applied themselves or were reviewed, for an audit trail.
 * A failed read leaves the list empty rather than blocking the importer.
 */
async function loadCaptainReports() {
  const select = `${MATCH_REPORT_SELECT},
    match:matches!match_reports_match_id_fkey (
      id, scheduled_at, best_of,
      team_a:teams!matches_team_a_id_fkey (id, name),
      team_b:teams!matches_team_b_id_fkey (id, name)
    ),
    team:teams!match_reports_team_id_fkey (id, name),
    submitter:profiles!match_reports_submitted_by_profile_id_fkey (id, display_name)`

  const [pending, recent] = await Promise.all([
    supabaseAdmin
      .from('match_reports')
      .select(select)
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('match_reports')
      .select(select)
      .neq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(10),
  ])
  if (pending.error || recent.error) {
    console.error('Failed to load captain reports:', pending.error ?? recent.error)
    return []
  }

  type Ref = { id: string; name?: string; display_name?: string | null }
  const pick = <T>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

  return [...(pending.data ?? []), ...(recent.data ?? [])].map((raw) => {
    const row = raw as unknown as MatchReportRow & {
      match: unknown
      team: unknown
      submitter: unknown
    }
    const match = pick(
      row.match as { scheduled_at?: string | null; team_a?: unknown; team_b?: unknown } | null
    )
    return {
      id: row.id,
      matchId: row.match_id,
      status: row.status,
      trackerInput: row.tracker_input,
      vetoLines: row.veto_lines ?? [],
      forfeitMap: row.forfeit_map,
      note: row.note,
      reviewReasons: row.review_reasons ?? [],
      preview: row.preview,
      reviewNote: row.review_note,
      reviewedAt: row.reviewed_at,
      createdAt: row.created_at,
      teamName: pick(row.team as Ref | null)?.name ?? null,
      submitterName: pick(row.submitter as Ref | null)?.display_name ?? null,
      matchLabel: match
        ? `${pick(match.team_a as Ref | null)?.name ?? 'TBD'} vs ${pick(match.team_b as Ref | null)?.name ?? 'TBD'}`
        : 'Unknown match',
      matchScheduledAt: (match?.scheduled_at as string | null) ?? null,
    }
  })
}

export const load = async ({ locals, url }: { locals: App.Locals; url: URL }) => {
  if (!locals.user) {
    throw redirect(303, '/auth/login?returnTo=/admin/matches-import')
  }

  await requireAdmin(locals.user)

  const [
    { data: profiles, error: profilesError },
    { data: teams, error: teamsError },
    { data: seasons, error: seasonsError },
  ] = await Promise.all([
    // Every approved Riot ID (and alias) per player, for CSV name matching.
    supabaseAdmin
      .from('player_directory')
      .select('id:profile_id, display_name, riot_ids')
      .order('display_name', { ascending: true }),
    supabaseAdmin
      .from('teams')
      .select('id, name, tag, metadata, season_id')
      .eq('approval_status', 'approved')
      .order('name', { ascending: true }),
    supabaseAdmin
      .from('seasons')
      .select('id, name, code, is_active')
      .order('is_active', { ascending: false })
      .order('starts_on', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
  ])

  if (profilesError) throw error(500, 'Failed to load profiles')
  if (teamsError) throw error(500, 'Failed to load teams')
  if (seasonsError) throw error(500, 'Failed to load seasons')

  const activeSeasonId = (seasons ?? []).find((s) => s.is_active)?.id ?? null

  const requestedMatchId = url.searchParams.get('match')
  const [targetMatches, captainReports] = await Promise.all([
    loadTargetMatches(requestedMatchId),
    loadCaptainReports(),
  ])

  return {
    captainReports,
    targetMatches,
    requestedMatchId: targetMatches.some((m) => m.id === requestedMatchId)
      ? requestedMatchId
      : null,
    profiles: profiles ?? [],
    teams: teams ?? [],
    seasons: seasons ?? [],
    activeSeasonId,
  }
}
