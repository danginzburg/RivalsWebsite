import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireProfile } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { getActiveMemberships, isCaptainLike } from '$lib/server/teams/membership'
import {
  bo3VetoSteps,
  getRemainingMaps,
  normalizeMapPool,
  type VetoAction,
} from '$lib/matches/veto'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function loadApprovedMatch(matchId: string) {
  const { data: match, error: matchError } = await supabaseAdmin
    .from('matches')
    .select('id, approval_status, best_of, team_a_id, team_b_id, metadata')
    .eq('id', matchId)
    .maybeSingle()

  if (matchError || !match) throw error(404, 'Match not found')
  if (match.approval_status !== 'approved') throw error(404, 'Match not found')
  return match
}

async function loadVetoActions(matchId: string) {
  const { data } = await supabaseAdmin
    .from('match_map_veto_actions')
    .select(
      'id, match_id, acting_team_id, acting_profile_id, action_type, map_name, action_order, created_at'
    )
    .eq('match_id', matchId)
    .order('action_order', { ascending: true })

  return (data ?? []) as VetoAction[]
}

function startingTeamIdForMatch(match: { team_a_id: string; team_b_id: string; metadata: any }) {
  const configured = normalizeOptional(match?.metadata?.veto_starting_team_id)
  if (configured && [match.team_a_id, match.team_b_id].includes(configured)) return configured
  return match.team_a_id
}

function computeNextStep(
  match: { team_a_id: string; team_b_id: string; metadata: any; best_of: number },
  actions: VetoAction[]
) {
  if (match.best_of !== 3) {
    return {
      done: true,
      reason: 'Veto only implemented for BO3',
      nextOrder: actions.length + 1,
      actingTeamId: null as string | null,
      actionType: null as 'ban' | 'pick' | null,
    }
  }

  const starting = startingTeamIdForMatch(match)
  const other = starting === match.team_a_id ? match.team_b_id : match.team_a_id
  const steps = bo3VetoSteps(starting, other)
  const nextIndex = actions.length
  const next = steps[nextIndex]

  return {
    done: !next,
    reason: !next ? 'Veto complete' : null,
    nextOrder: actions.length + 1,
    actingTeamId: next?.actingTeamId ?? null,
    actionType: next?.actionType ?? null,
  }
}

async function canActForTeam(profileId: string, role: string | undefined, teamId: string) {
  if (role === 'admin') return true
  const memberships = await getActiveMemberships(profileId)
  return memberships.some((m) => m.team_id === teamId && isCaptainLike(m.role))
}

export const GET: RequestHandler = async ({ params }) => {
  const matchId = params.id
  if (!matchId) throw error(400, 'Missing match id')

  const match = await loadApprovedMatch(matchId)
  const actions = await loadVetoActions(matchId)
  const mapPool = normalizeMapPool(match?.metadata?.map_pool)
  const remainingMaps = getRemainingMaps(mapPool, actions)
  const next = computeNextStep(match as any, actions)

  return json({
    matchId,
    mapPool,
    actions,
    remainingMaps,
    next,
  })
}

export const POST: RequestHandler = async ({ locals, request, params }) => {
  const matchId = params.id
  if (!matchId) throw error(400, 'Missing match id')

  const profile = await requireProfile(locals.user)
  const match = await loadApprovedMatch(matchId)
  const actions = await loadVetoActions(matchId)

  if (match.best_of !== 3) throw error(400, 'Veto only implemented for BO3')

  const next = computeNextStep(match as any, actions)
  if (next.done || !next.actingTeamId || !next.actionType) {
    throw error(409, 'Veto is already complete')
  }

  const allowed = await canActForTeam(profile.id, profile.role, next.actingTeamId)
  if (!allowed) throw error(403, 'Not allowed to act for this step')

  const body = await request.json()
  const mapName = normalizeOptional(body.mapName)
  if (!mapName) throw error(400, 'mapName is required')

  const mapPool = normalizeMapPool(match?.metadata?.map_pool)
  const remaining = getRemainingMaps(mapPool, actions)
  if (!remaining.includes(mapName)) throw error(400, 'Map is not available')

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('match_map_veto_actions')
    .insert({
      match_id: matchId,
      acting_team_id: next.actingTeamId,
      acting_profile_id: profile.id,
      action_type: next.actionType,
      map_name: mapName,
      action_order: next.nextOrder,
    })
    .select(
      'id, match_id, acting_team_id, acting_profile_id, action_type, map_name, action_order, created_at'
    )
    .single()

  if (insertError || !inserted) {
    // Unique constraint on (match_id, action_order) can be hit with concurrent submits.
    throw error(409, 'Veto step already taken, refresh and try again')
  }

  return json({ success: true, action: inserted }, { status: 201 })
}

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const matchId = params.id
  if (!matchId) throw error(400, 'Missing match id')

  const profile = await requireProfile(locals.user)
  if (profile.role !== 'admin') throw error(403, 'Administrator privileges required')

  await loadApprovedMatch(matchId)

  const { error: deleteError } = await supabaseAdmin
    .from('match_map_veto_actions')
    .delete()
    .eq('match_id', matchId)

  if (deleteError) throw error(500, 'Failed to reset veto')
  return json({ success: true })
}
