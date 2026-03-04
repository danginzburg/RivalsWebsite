import { error, json, type RequestHandler } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { requireAdmin } from '$lib/server/auth/profile'
import { logAdminAction } from '$lib/server/audit/admin-actions'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
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
  const role = normalizeMembershipRole(body.role)

  if (!teamId || !profileId) throw error(400, 'Missing teamId or profileId')

  const { data: team, error: teamError } = await supabaseAdmin
    .from('teams')
    .select('id, approval_status')
    .eq('id', teamId)
    .maybeSingle()

  if (teamError || !team) throw error(404, 'Team not found')
  if (team.approval_status !== 'approved') {
    throw error(400, 'Team must be approved before adding players')
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('id', profileId)
    .maybeSingle()

  if (profileError || !profile) throw error(404, 'User not found')

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('team_memberships')
    .select('id, team_id')
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .is('left_at', null)
    .maybeSingle()

  if (existingError) throw error(500, 'Failed to validate existing membership')
  if (existing) {
    throw error(409, 'Player is already on a team (remove them first)')
  }

  const today = new Date().toISOString().slice(0, 10)
  const { data: created, error: createError } = await supabaseAdmin
    .from('team_memberships')
    .insert({
      team_id: teamId,
      profile_id: profileId,
      role,
      joined_at: today,
      is_active: true,
    })
    .select('id')
    .single()

  if (createError || !created) throw error(500, 'Failed to add player to team')

  await logAdminAction({
    adminProfileId: adminProfile.id,
    actionType: 'team_player_added',
    targetTable: 'team_memberships',
    targetId: String(created.id),
    details: { teamId, profileId, role },
  })

  return json({ success: true })
}

export const DELETE: RequestHandler = async ({ locals, request }) => {
  const adminProfile = await requireAdmin(locals.user)
  const body = await request.json()
  const teamId = normalizeOptional(body.teamId)

  if (!teamId) {
    throw error(400, 'Missing teamId')
  }

  const { data: existingTeam, error: existingTeamError } = await supabaseAdmin
    .from('teams')
    .select('id, name, approval_status')
    .eq('id', teamId)
    .single()

  if (existingTeamError || !existingTeam) {
    throw error(404, 'Team not found')
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
    .update({ is_active: false, left_at: new Date().toISOString().slice(0, 10) })
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

  if (!teamId || !profileId) {
    throw error(400, 'Missing teamId or profileId')
  }

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from('team_memberships')
    .select('id, role')
    .eq('team_id', teamId)
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .is('left_at', null)
    .maybeSingle()

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
      left_at: new Date().toISOString().slice(0, 10),
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
      role: membership.role,
    },
  })

  return json({ success: true })
}
