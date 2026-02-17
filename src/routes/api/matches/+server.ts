import { error, json, type RequestHandler } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import {
  DEFAULT_MAP_POOL,
  getDeciderMap,
  getPickedMaps,
  getRemainingMaps,
  normalizeMapPool,
  type VetoAction,
} from '$lib/matches/veto'

function safeInt(value: string | null, fallback: number) {
  if (!value) return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export const GET: RequestHandler = async ({ url }) => {
  const limit = Math.min(25, Math.max(1, safeInt(url.searchParams.get('limit'), 5)))
  const includeCompleted = url.searchParams.get('includeCompleted') === 'true'

  let query = supabaseAdmin
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
      metadata,
      team_a:teams!matches_team_a_id_fkey (id, name, tag, logo_path),
      team_b:teams!matches_team_b_id_fkey (id, name, tag, logo_path)
    `
    )
    .eq('approval_status', 'approved')

  if (!includeCompleted) {
    query = query.in('status', ['scheduled', 'live'])
  }

  const { data: matches, error: matchesError } = await query
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .limit(limit)

  if (matchesError) throw error(500, 'Failed to load matches')

  const matchIds = (matches ?? []).map((m: any) => m.id)

  let streamsByMatch: Record<string, any[]> = {}
  if (matchIds.length > 0) {
    const { data: streams } = await supabaseAdmin
      .from('match_streams')
      .select('id, match_id, platform, stream_url, is_primary, status')
      .in('match_id', matchIds)
      .order('is_primary', { ascending: false })

    streamsByMatch = (streams ?? []).reduce(
      (acc: Record<string, any[]>, s: any) => {
        if (!acc[s.match_id]) acc[s.match_id] = []
        acc[s.match_id].push(s)
        return acc
      },
      {} as Record<string, any[]>
    )
  }

  let vetoByMatch: Record<string, VetoAction[]> = {}
  if (matchIds.length > 0) {
    const { data: vetoActions } = await supabaseAdmin
      .from('match_map_veto_actions')
      .select('match_id, action_type, map_name, action_order')
      .in('match_id', matchIds)
      .order('action_order', { ascending: true })

    vetoByMatch = (vetoActions ?? []).reduce(
      (acc: Record<string, VetoAction[]>, a: any) => {
        if (!a.match_id) return acc
        if (!acc[a.match_id]) acc[a.match_id] = []
        acc[a.match_id].push(a)
        return acc
      },
      {} as Record<string, VetoAction[]>
    )
  }

  const teamLogoUrlCache = new Map<string, string | null>()
  function getTeamLogoUrl(team: any): string | null {
    if (!team?.id) return null
    if (teamLogoUrlCache.has(team.id)) return teamLogoUrlCache.get(team.id) ?? null
    const url = team.logo_path
      ? supabaseAdmin.storage.from('team-logos').getPublicUrl(team.logo_path).data.publicUrl
      : null
    teamLogoUrlCache.set(team.id, url)
    return url
  }

  const normalized = (matches ?? []).map((match: any) => {
    const actions = vetoByMatch[match.id] ?? []
    const mapPool = normalizeMapPool(match?.metadata?.map_pool ?? DEFAULT_MAP_POOL)
    const picked = getPickedMaps(actions)
    const decider = getDeciderMap(mapPool, actions)
    const remaining = getRemainingMaps(mapPool, actions)

    const maps: string[] = []
    for (const m of picked) maps.push(m)
    if (decider && maps.length < 3) maps.push(decider)

    const streams = streamsByMatch[match.id] ?? []
    const primaryStream = streams.find((s: any) => s.is_primary) ?? streams[0] ?? null

    return {
      id: match.id,
      status: match.status,
      best_of: match.best_of,
      scheduled_at: match.scheduled_at,
      started_at: match.started_at,
      ended_at: match.ended_at,
      team_a_score: match.team_a_score,
      team_b_score: match.team_b_score,
      team_a: {
        id: match.team_a?.id,
        name: match.team_a?.name,
        tag: match.team_a?.tag,
        logo_url: getTeamLogoUrl(match.team_a),
      },
      team_b: {
        id: match.team_b?.id,
        name: match.team_b?.name,
        tag: match.team_b?.tag,
        logo_url: getTeamLogoUrl(match.team_b),
      },
      streams,
      primary_stream_url: primaryStream?.stream_url ?? null,
      maps,
      maps_remaining_count: remaining.length,
    }
  })

  return json({ matches: normalized })
}
