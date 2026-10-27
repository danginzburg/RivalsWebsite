import { error, json, type RequestHandler } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { requireAdmin } from '$lib/server/auth/profile'
import { logAdminAction } from '$lib/server/audit/admin-actions'
import { resolveRosterIdentity, resolveRosterIdentityByPuuid } from '$lib/server/teams/membership'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

type ExistingMembershipRow = {
  id: string
  team_id: string
  teams?: { name?: string | null } | Array<{ name?: string | null }> | null
}

function conflictLabel(row: ExistingMembershipRow): string {
  const team = Array.isArray(row.teams) ? row.teams[0] : row.teams
  const name = typeof team?.name === 'string' ? team.name.trim() : ''
  return name ? `"${name}"` : 'a team'
}

const MEMBERSHIP_ROLES = ['player', 'captain', 'substitute', 'coach', 'manager'] as const
type MembershipRole = (typeof MEMBERSHIP_ROLES)[number]

function normalizeMembershipRole(value: unknown): MembershipRole {
  const raw = normalizeOptional(value)
  if (!raw) return 'player'
  const lowered = raw.toLowerCase()
  if ((MEMBERSHIP_ROLES as readonly string[]).includes(lowered)) return lowered as MembershipRole
  throw error(400, 'Invalid membership role')
}

export const POST: RequestHandler = async ({ locals, request }) => {
  const adminProfile = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const teamId = normalizeOptional(body.teamId)
  const profileId = normalizeOptional(body.profileId)
  const playerName = normalizeOptional(body.playerName)
  const role = normalizeMembershipRole(body.role)
  // A player moving teams mid-event: close their current stint instead of
  // refusing, so the event keeps a record of both teams.
  const transfer = body.transfer === true

  // Resolve the typed identity to a profile + PUUID so the slot can be matched
  // to imported stats by identity (see resolveRosterIdentity). An explicit
  // profileId from a picker wins; otherwise the player name is resolved.
  const identity = playerName
    ? await resolveRosterIdentity(playerName)
    : { profileId: null, puuid: null, playerName: '' }
  const resolvedProfileId = profileId ?? identity.profileId
  let resolvedPuuid = identity.puuid
  // When the picker supplied a profile directly, pull its PUUID for matching.
  if (profileId && !resolvedPuuid) {
    const { data: primary } = await supabaseAdmin
      .from('riot_accounts')
      .select('puuid')
      .eq('profile_id', profileId)
      .eq('is_primary', true)
      .maybeSingle()
    resolvedPuuid = (primary?.puuid as string | null) ?? null
  }

  if (!teamId || (!resolvedProfileId && !playerName))
    throw error(400, 'Missing teamId and player identity')

  const { data: team, error: teamError } = await supabaseAdmin
    .from('teams')
    .select('id, approval_status, season_id')
    .eq('id', teamId)
    .maybeSingle()

  if (teamError || !team) throw error(404, 'Team not found')
  if (team.approval_status !== 'approved') {
    throw error(400, 'Team must be approved before adding players')
  }

  if (resolvedProfileId) {
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', resolvedProfileId)
      .maybeSingle()

    if (profileError || !profile) throw error(404, 'User not found')
  }

  /**
   * A roster spot is exclusive within its season, not across all of history: the
   * same player is expected to turn up on a different team in every past season
   * being backfilled. Both duplicate checks are therefore scoped to the season
   * this team is filed under (including the "no season" bucket).
   */
  const targetSeasonId = team.season_id as string | null

  let profileScoped = supabaseAdmin
    .from('team_memberships')
    .select('id, team_id, teams (name)')
    .eq('profile_id', resolvedProfileId ?? '')
    .eq('is_active', true)
    .is('left_at', null)

  profileScoped = targetSeasonId
    ? profileScoped.eq('season_id', targetSeasonId)
    : profileScoped.is('season_id', null)

  let nameScoped = supabaseAdmin
    .from('team_memberships')
    .select('id, team_id, teams (name)')
    .ilike('player_name', playerName ?? '')
    .eq('is_active', true)
    .is('left_at', null)

  nameScoped = targetSeasonId
    ? nameScoped.eq('season_id', targetSeasonId)
    : nameScoped.is('season_id', null)

  const emptyResult = Promise.resolve({
    data: null as ExistingMembershipRow | null,
    error: null as { message?: string | null } | null,
  })

  const profileQuery = resolvedProfileId ? profileScoped.maybeSingle() : emptyResult
  const playerNameQuery = playerName ? nameScoped.maybeSingle() : emptyResult

  const [
    { data: existing, error: existingError },
    { data: existingByName, error: existingByNameError },
  ] = await Promise.all([profileQuery, playerNameQuery])

  if (existingError) throw error(500, 'Failed to validate existing membership')
  if (existingByNameError) throw error(500, 'Failed to validate existing named membership')

  const conflicts = [existing, existingByName].filter((row): row is ExistingMembershipRow =>
    Boolean(row)
  )
  if (conflicts.some((row) => row.team_id === teamId)) {
    throw error(409, 'Player is already on this team')
  }
  if (conflicts.length > 0 && !transfer) {
    // `transferable` tells the admin UI it can offer to move the player rather
    // than just reporting the clash.
    const subject = existing ? 'Player is' : 'That player name is'
    return json(
      {
        message: `${subject} already on ${conflictLabel(conflicts[0])} this season`,
        transferable: true,
        fromTeam: conflictLabel(conflicts[0]),
      },
      { status: 409 }
    )
  }

  const now = new Date().toISOString()
  const closedIds = Array.from(new Set(conflicts.map((row) => row.id)))
  if (closedIds.length > 0) {
    // left_at marks the move; the old row stays so earlier matches in the event
    // still see the player on the team they played for then.
    const { error: closeError } = await supabaseAdmin
      .from('team_memberships')
      .update({ is_active: false, left_at: now })
      .in('id', closedIds)
    if (closeError) throw error(500, 'Failed to close previous team membership')
  }

  const { data: created, error: createError } = await supabaseAdmin
    .from('team_memberships')
    .insert({
      team_id: teamId,
      profile_id: resolvedProfileId,
      player_name: playerName,
      puuid: resolvedPuuid,
      role,
      joined_at: now,
      is_active: true,
    })
    .select('id')
    .single()

  if (createError || !created) throw error(500, 'Failed to add player to team')

  await logAdminAction({
    adminProfileId: adminProfile.id,
    actionType: closedIds.length > 0 ? 'team_player_transferred' : 'team_player_added',
    targetTable: 'team_memberships',
    targetId: String(created.id),
    details: {
      teamId,
      profileId: resolvedProfileId,
      playerName,
      role,
      ...(closedIds.length > 0
        ? {
            fromTeamIds: Array.from(new Set(conflicts.map((row) => row.team_id))),
            closedMembershipIds: closedIds,
          }
        : {}),
    },
  })

  return json({ success: true, transferred: closedIds.length > 0 })
}

export const DELETE: RequestHandler = async ({ locals, request }) => {
  const adminProfile = await requireAdmin(locals.user)
  const body = await request.json()
  const teamId = normalizeOptional(body.teamId)
  // Disbanding keeps the team approved so its matches, stats and page history
  // stay visible; removal also pulls it out of the approved set.
  const disbandOnly = body.disband === true

  if (!teamId) {
    throw error(400, 'Missing teamId')
  }

  const { data: existingTeam, error: existingTeamError } = await supabaseAdmin
    .from('teams')
    .select('id, name, approval_status, status')
    .eq('id', teamId)
    .single()

  if (existingTeamError || !existingTeam) {
    throw error(404, 'Team not found')
  }

  if (disbandOnly) {
    const { error: disbandError } = await supabaseAdmin
      .from('teams')
      .update({ status: 'disbanded' })
      .eq('id', teamId)

    if (disbandError) {
      throw error(500, 'Failed to disband team')
    }

    await supabaseAdmin
      .from('team_memberships')
      .update({ is_active: false, left_at: new Date().toISOString() })
      .eq('team_id', teamId)
      .eq('is_active', true)

    await logAdminAction({
      adminProfileId: adminProfile.id,
      actionType: 'team_disbanded',
      targetTable: 'teams',
      targetId: teamId,
      details: {
        teamName: existingTeam.name,
        previousStatus: existingTeam.status,
      },
    })

    return json({ success: true })
  }

  const { error: updateError } = await supabaseAdmin
    .from('teams')
    .update({
      approval_status: 'disabled',
      status: 'disbanded',
      approval_notes: 'Removed by administrator',
      approved_by_profile_id: adminProfile.id,
      approved_at: new Date().toISOString(),
    })
    .eq('id', teamId)

  if (updateError) {
    throw error(500, 'Failed to remove team')
  }

  await supabaseAdmin
    .from('team_memberships')
    .update({ is_active: false, left_at: new Date().toISOString() })
    .eq('team_id', teamId)
    .eq('is_active', true)

  await logAdminAction({
    adminProfileId: adminProfile.id,
    actionType: 'team_removed',
    targetTable: 'teams',
    targetId: teamId,
    details: {
      teamName: existingTeam.name,
      previousStatus: existingTeam.approval_status,
    },
  })

  return json({ success: true })
}

export const PATCH: RequestHandler = async ({ locals, request }) => {
  const adminProfile = await requireAdmin(locals.user)
  const body = await request.json()

  const teamId = normalizeOptional(body.teamId)
  const profileId = normalizeOptional(body.profileId)
  const membershipId = Number(body.membershipId)

  if (!teamId || (!profileId && !Number.isFinite(membershipId))) {
    throw error(400, 'Missing teamId or membership target')
  }

  let query = supabaseAdmin
    .from('team_memberships')
    .select('id, role, profile_id, player_name')
    .eq('team_id', teamId)
    .eq('is_active', true)
    .is('left_at', null)

  query = Number.isFinite(membershipId)
    ? query.eq('id', membershipId)
    : query.eq('profile_id', profileId)

  const { data: membership, error: membershipError } = await query.maybeSingle()

  if (membershipError) {
    throw error(500, 'Failed to validate membership')
  }

  if (!membership) {
    throw error(404, 'Active team member not found')
  }

  const { error: updateError } = await supabaseAdmin
    .from('team_memberships')
    .update({
      is_active: false,
      left_at: new Date().toISOString(),
    })
    .eq('id', membership.id)

  if (updateError) {
    throw error(500, 'Failed to remove player from team')
  }

  await logAdminAction({
    adminProfileId: adminProfile.id,
    actionType: 'team_player_removed',
    targetTable: 'team_memberships',
    targetId: String(membership.id),
    details: {
      teamId,
      profileId,
      playerName: membership.player_name ?? null,
      role: membership.role,
    },
  })

  return json({ success: true })
}

/**
 * Re-point an existing roster slot at a Riot ID, in place.
 *
 * Roster slots typed as bare handles ("Penguinz") rarely match the Riot IDs in
 * the stats ("Penguin#1234"), which marks the real player a sub. Resolving the
 * Riot ID captures its PUUID from Riot even for a player who has never signed
 * in, and that is enough to match their stats; their profile attaches later
 * through claim-relink when they connect the account.
 *
 * Unlike remove-and-re-add, this keeps the slot's dates, so it works on closed
 * slots and disbanded teams and leaves no false departure in the team history.
 */
export const PUT: RequestHandler = async ({ locals, request }) => {
  const adminProfile = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const membershipId = Number(body.membershipId)
  const riotId = normalizeOptional(body.riotId)
  // Set when the admin picked an account seen in the team's matches.
  const knownPuuid = normalizeOptional(body.puuid)
  if (!Number.isFinite(membershipId) || !riotId) {
    throw error(400, 'Missing membershipId or riotId')
  }

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from('team_memberships')
    .select('id, team_id, profile_id, player_name, puuid')
    .eq('id', membershipId)
    .maybeSingle()

  if (membershipError) throw error(500, 'Failed to load roster slot')
  if (!membership) throw error(404, 'Roster slot not found')

  const identity = knownPuuid
    ? await resolveRosterIdentityByPuuid(riotId, knownPuuid)
    : await resolveRosterIdentity(riotId)
  const next = {
    player_name: identity.playerName,
    puuid: identity.puuid,
    profile_id: identity.profileId ?? membership.profile_id ?? null,
  }

  const { error: updateError } = await supabaseAdmin
    .from('team_memberships')
    .update(next)
    .eq('id', membershipId)

  if (updateError) {
    if (updateError.code === '23505') {
      throw error(
        409,
        `${identity.playerName} already holds an open roster spot on another team this season; a player can only hold one at a time`
      )
    }
    throw error(500, 'Failed to update roster slot')
  }

  await logAdminAction({
    adminProfileId: adminProfile.id,
    actionType: 'team_player_identity_set',
    targetTable: 'team_memberships',
    targetId: String(membershipId),
    details: {
      teamId: membership.team_id,
      previous: {
        playerName: membership.player_name ?? null,
        puuid: membership.puuid ?? null,
        profileId: membership.profile_id ?? null,
      },
      next: { playerName: next.player_name, puuid: next.puuid, profileId: next.profile_id },
    },
  })

  return json({
    success: true,
    slot: {
      playerName: next.player_name,
      puuid: next.puuid,
      hasPuuid: Boolean(next.puuid),
      hasProfile: Boolean(next.profile_id),
    },
  })
}
