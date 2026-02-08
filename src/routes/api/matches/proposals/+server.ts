import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireProfile } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { getActiveMemberships, isCaptainLike } from '$lib/server/teams/membership'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const GET: RequestHandler = async ({ locals }) => {
  const profile = await requireProfile(locals.user)

  const memberships = await getActiveMemberships(profile.id)
  const teamIds = memberships.map((m) => m.team_id)

  let query = supabaseAdmin
    .from('match_proposals')
    .select(
      `
      id,
      status,
      best_of,
      proposed_start_at,
      notes,
      created_at,
      season_id,
      proposed_by_team_id,
      opponent_team_id,
      proposed_by_profile_id,
      approval_notes,
      proposed_team:teams!match_proposals_proposed_by_team_id_fkey (
        id,
        name,
        tag
      ),
      opponent_team:teams!match_proposals_opponent_team_id_fkey (
        id,
        name,
        tag
      )
    `
    )
    .order('created_at', { ascending: false })

  if (profile.role !== 'admin') {
    if (teamIds.length === 0) return json({ proposals: [] })
    const proposerFilters = teamIds.map((id) => `proposed_by_team_id.eq.${id}`)
    const opponentFilters = teamIds.map((id) => `opponent_team_id.eq.${id}`)
    query = query.or([...proposerFilters, ...opponentFilters].join(','))
  }

  const { data, error: fetchError } = await query

  if (fetchError) {
    throw error(500, 'Failed to load match proposals')
  }

  return json({ proposals: data ?? [] })
}

export const POST: RequestHandler = async ({ locals, request }) => {
  const profile = await requireProfile(locals.user)
  const body = await request.json()

  const proposedByTeamId = normalizeOptional(body.proposedByTeamId)
  const opponentTeamId = normalizeOptional(body.opponentTeamId)
  const proposedStartAt = normalizeOptional(body.proposedStartAt)
  const notes = normalizeOptional(body.notes)
  const seasonId = normalizeOptional(body.seasonId)
  const bestOfRaw = Number(body.bestOf)
  const bestOf = Number.isFinite(bestOfRaw) ? bestOfRaw : 3

  if (!proposedByTeamId || !opponentTeamId) {
    throw error(400, 'Both teams are required')
  }
  if (proposedByTeamId === opponentTeamId) {
    throw error(400, 'Teams must be different')
  }
  if (![1, 3, 5, 7].includes(bestOf)) {
    throw error(400, 'Best-of must be 1, 3, 5, or 7')
  }

  const memberships = await getActiveMemberships(profile.id)
  const membership = memberships.find((m) => m.team_id === proposedByTeamId)
  if (!membership || !isCaptainLike(membership.role)) {
    throw error(403, 'Only captains/managers can propose matches for this team')
  }

  const { data: proposal, error: insertError } = await supabaseAdmin
    .from('match_proposals')
    .insert({
      season_id: seasonId,
      proposed_by_team_id: proposedByTeamId,
      opponent_team_id: opponentTeamId,
      proposed_by_profile_id: profile.id,
      status: 'pending',
      best_of: bestOf,
      proposed_start_at: proposedStartAt,
      notes,
    })
    .select('id, status, best_of, proposed_start_at, notes, proposed_by_team_id, opponent_team_id')
    .single()

  if (insertError || !proposal) {
    throw error(500, 'Failed to create match proposal')
  }

  return json({ success: true, proposal }, { status: 201 })
}
