import { error, json, type RequestHandler } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { requireProfile } from '$lib/server/auth/profile'
import {
  MAX_TEAM_AVERAGE,
  MAX_TEAM_PLAYERS,
  MIN_TEAM_PLAYERS,
  TEAM_BALANCE_RANKS,
  computeTopFiveAverage,
} from '$lib/team-balance'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const GET: RequestHandler = async () => {
  const { data, error: fetchError } = await supabaseAdmin
    .from('teams')
    .select('id, name, tag, logo_path, status, approval_status, created_at')
    .eq('approval_status', 'approved')
    .order('name', { ascending: true })

  if (fetchError) {
    throw error(500, 'Failed to load teams')
  }

  return json({ teams: data ?? [] })
}

export const POST: RequestHandler = async ({ locals, request }) => {
  const profile = await requireProfile(locals.user)
  const body = await request.json()

  const name = normalizeOptional(body.name)
  const tag = normalizeOptional(body.tag)
  const logoPath = normalizeOptional(body.logoPath)
  const headCoachName = normalizeOptional(body.headCoachName)
  const assistantCoachName = normalizeOptional(body.assistantCoachName)
  const roster: Array<{ profileId?: unknown }> = Array.isArray(body.roster) ? body.roster : []

  if (!name || name.length < 2 || name.length > 48) {
    throw error(400, 'Team name must be between 2 and 48 characters')
  }

  if (!tag || !/^[A-Za-z]{2,4}$/.test(tag)) {
    throw error(400, 'Team tag is required and must be 2-4 letters')
  }

  if (!logoPath) {
    throw error(400, 'Team logo is required')
  }

  if (roster.length < MIN_TEAM_PLAYERS) {
    throw error(400, `Team roster must include at least ${MIN_TEAM_PLAYERS} players`)
  }

  if (roster.length > MAX_TEAM_PLAYERS) {
    throw error(400, `Team roster can include at most ${MAX_TEAM_PLAYERS} players`)
  }

  const rosterProfileIds = roster
    .map((entry) => normalizeOptional(entry?.profileId))
    .filter((profileId): profileId is string => Boolean(profileId))

  if (rosterProfileIds.length < MIN_TEAM_PLAYERS) {
    throw error(400, `At least ${MIN_TEAM_PLAYERS} players must be selected`)
  }

  if (rosterProfileIds.length > MAX_TEAM_PLAYERS) {
    throw error(400, `Team roster can include at most ${MAX_TEAM_PLAYERS} players`)
  }

  if (new Set(rosterProfileIds).size !== rosterProfileIds.length) {
    throw error(400, 'Duplicate players are not allowed in roster selection')
  }

  const { data: selectedPlayers, error: selectedPlayersError } = await supabaseAdmin
    .from('player_registration')
    .select('profile_id, riot_id, rank_label')
    .in('profile_id', rosterProfileIds)

  if (selectedPlayersError) {
    throw error(500, 'Failed to load selected players')
  }

  if (!selectedPlayers || selectedPlayers.length !== rosterProfileIds.length) {
    throw error(400, 'One or more selected players are not registered')
  }

  const validRankNames: string[] = TEAM_BALANCE_RANKS.map((r) => r.name)
  for (const player of selectedPlayers) {
    if (!player.rank_label || !validRankNames.includes(player.rank_label)) {
      throw error(
        400,
        `Player ${player.riot_id} cannot be added until an admin assigns a valid rank`
      )
    }
  }

  const topFiveAverage = computeTopFiveAverage(selectedPlayers.map((player) => player.rank_label!))
  if (topFiveAverage > MAX_TEAM_AVERAGE) {
    throw error(
      400,
      `Team is ineligible. Top five average (${topFiveAverage.toFixed(2)}) exceeds ${MAX_TEAM_AVERAGE}`
    )
  }

  const totalPeople =
    selectedPlayers.length + (headCoachName ? 1 : 0) + (assistantCoachName ? 1 : 0)
  if (totalPeople > 10) {
    throw error(400, 'Team can have at most 10 total people (8 players + 2 coaches)')
  }

  const { data: registration, error: registrationError } = await supabaseAdmin
    .from('player_registration')
    .select('profile_id')
    .eq('profile_id', profile.id)
    .single()

  if (registrationError || !registration) {
    throw error(400, 'You must complete player registration before creating a team')
  }

  if (profile.role !== 'admin') {
    const { data: approvedSubmittedTeam, error: approvedSubmittedTeamError } = await supabaseAdmin
      .from('teams')
      .select('id')
      .eq('submitted_by_profile_id', profile.id)
      .eq('approval_status', 'approved')
      .maybeSingle()

    if (approvedSubmittedTeamError) {
      throw error(500, 'Failed to validate existing approved team ownership')
    }

    if (approvedSubmittedTeam) {
      throw error(409, 'You already have an approved team and cannot create another team.')
    }
  }

  const { data: activeMembership, error: membershipError } = await supabaseAdmin
    .from('team_memberships')
    .select('id, team_id')
    .eq('profile_id', profile.id)
    .eq('is_active', true)
    .is('left_at', null)
    .maybeSingle()

  if (membershipError) {
    throw error(500, 'Failed to validate team membership')
  }

  if (activeMembership) {
    throw error(409, 'You already have an active team membership')
  }

  const { data: team, error: teamError } = await supabaseAdmin
    .from('teams')
    .insert({
      name,
      tag,
      logo_path: logoPath,
      approval_status: 'pending',
      submitted_by_profile_id: profile.id,
      metadata: {
        initial_roster: selectedPlayers,
        coaches: {
          head_coach: headCoachName,
          assistant_coach: assistantCoachName,
        },
        top_five_average: topFiveAverage,
      },
    })
    .select('id, name, tag, logo_path, approval_status, created_at, metadata')
    .single()

  if (teamError || !team) {
    if (teamError?.code === '23505') {
      throw error(409, 'Team name or tag conflicts with an existing approved team')
    }
    throw error(500, 'Failed to create team')
  }

  const { error: insertMembershipError } = await supabaseAdmin.from('team_memberships').insert({
    team_id: team.id,
    profile_id: profile.id,
    role: 'captain',
    is_active: true,
  })

  if (insertMembershipError) {
    await supabaseAdmin.from('teams').delete().eq('id', team.id)
    throw error(500, 'Failed to create captain membership for this team')
  }

  const inviteRows = selectedPlayers
    .filter((player) => player.profile_id !== profile.id)
    .map((player) => ({
      team_id: team.id,
      invited_profile_id: player.profile_id,
      invited_by_profile_id: profile.id,
      status: 'pending',
      role: 'player',
      message: 'You were selected for this team draft. Accept to join if approved.',
      metadata: {
        source: 'team_draft_creation',
      },
    }))

  if (inviteRows.length > 0) {
    const { error: inviteError } = await supabaseAdmin.from('team_invites').insert(inviteRows)

    if (inviteError) {
      await supabaseAdmin.from('team_memberships').delete().eq('team_id', team.id)
      await supabaseAdmin.from('teams').delete().eq('id', team.id)
      throw error(500, 'Failed to create team invites')
    }
  }

  return json({ success: true, team }, { status: 201 })
}
