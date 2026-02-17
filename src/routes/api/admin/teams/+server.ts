import { error, json, type RequestHandler } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { requireAdmin } from '$lib/server/auth/profile'
import { logAdminAction } from '$lib/server/audit/admin-actions'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const GET: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals.user)

  const { data, error: fetchError } = await supabaseAdmin
    .from('teams')
    .select(
      `
      id,
      name,
      tag,
      logo_path,
      metadata,
      status,
      approval_status,
      approval_notes,
      created_at,
      profiles!teams_submitted_by_profile_id_fkey (
        id,
        display_name,
        email
      )
    `
    )
    .in('approval_status', ['pending', 'approved'])
    .order('created_at', { ascending: false })

  if (fetchError) {
    throw error(500, 'Failed to load team moderation queue')
  }

  const teams = (data ?? []).map((team) => ({
    ...team,
    logo_url: team.logo_path
      ? supabaseAdmin.storage.from('team-logos').getPublicUrl(team.logo_path).data.publicUrl
      : null,
  }))

  const approvedTeamIds = teams
    .filter((team) => team.approval_status === 'approved')
    .map((team) => team.id)

  let captainMap = new Map<string, { display_name: string | null; email: string | null }>()
  let rosterMap = new Map<
    string,
    Array<{
      profile_id: string
      role: string
      riot_id: string
      display_name: string | null
      email: string | null
    }>
  >()

  if (approvedTeamIds.length > 0) {
    const { data: captainRows } = await supabaseAdmin
      .from('team_memberships')
      .select(
        `
        team_id,
        player_registration!team_memberships_profile_id_fkey (
          profiles!player_registration_profile_id_fkey (
            display_name,
            email
          )
        )
      `
      )
      .in('team_id', approvedTeamIds)
      .eq('role', 'captain')
      .eq('is_active', true)
      .is('left_at', null)

    captainMap = new Map(
      (captainRows ?? []).map((row: any) => {
        const rel = Array.isArray(row.player_registration)
          ? row.player_registration[0]
          : row.player_registration
        const profileRel = Array.isArray(rel?.profiles) ? rel.profiles[0] : rel?.profiles
        return [
          row.team_id,
          {
            display_name: profileRel?.display_name ?? null,
            email: profileRel?.email ?? null,
          },
        ]
      })
    )
  }

  const rosterCountMap = new Map<string, number>()
  if (approvedTeamIds.length > 0) {
    const { data: rosterRows } = await supabaseAdmin
      .from('team_memberships')
      .select(
        `
        team_id,
        profile_id,
        role,
        player_registration!team_memberships_profile_id_fkey (
          riot_id,
          profiles!player_registration_profile_id_fkey (
            display_name,
            email
          )
        )
      `
      )
      .in('team_id', approvedTeamIds)
      .eq('is_active', true)
      .is('left_at', null)

    rosterMap = new Map()
    for (const row of rosterRows ?? []) {
      rosterCountMap.set(row.team_id, (rosterCountMap.get(row.team_id) ?? 0) + 1)

      const reg = Array.isArray((row as any).player_registration)
        ? (row as any).player_registration[0]
        : (row as any).player_registration
      const profileRel = Array.isArray(reg?.profiles) ? reg.profiles[0] : reg?.profiles

      const rosterEntry = {
        profile_id: row.profile_id,
        role: row.role,
        riot_id: reg?.riot_id ?? 'Unknown',
        display_name: profileRel?.display_name ?? null,
        email: profileRel?.email ?? null,
      }

      const current = rosterMap.get(row.team_id) ?? []
      current.push(rosterEntry)
      rosterMap.set(row.team_id, current)
    }
  }

  const decoratedTeams = teams.map((team) => ({
    ...team,
    captain_profile: captainMap.get(team.id) ?? null,
    roster_count: rosterCountMap.get(team.id) ?? 0,
    roster: rosterMap.get(team.id) ?? [],
  }))

  return json({
    queue: decoratedTeams.filter((team) => team.approval_status === 'pending'),
    approved: decoratedTeams.filter((team) => team.approval_status === 'approved'),
  })
}

export const PATCH: RequestHandler = async ({ locals, request }) => {
  const adminProfile = await requireAdmin(locals.user)
  const body = await request.json()

  const teamId = normalizeOptional(body.teamId)
  const action = normalizeOptional(body.action)
  const notes = normalizeOptional(body.notes)
  const moderatedName = normalizeOptional(body.name)
  const moderatedTag = normalizeOptional(body.tag)
  const moderatedLogoPath = normalizeOptional(body.logoPath)

  if (!teamId) {
    throw error(400, 'Missing teamId')
  }

  if (action !== 'approve' && action !== 'reject') {
    throw error(400, "Action must be 'approve' or 'reject'")
  }

  const { data: existingTeam, error: teamError } = await supabaseAdmin
    .from('teams')
    .select('id, approval_status')
    .eq('id', teamId)
    .single()

  if (teamError || !existingTeam) {
    throw error(404, 'Team not found')
  }

  const updatePayload: Record<string, unknown> = {
    approval_status: action === 'approve' ? 'approved' : 'rejected',
    approval_notes: notes,
    approved_by_profile_id: adminProfile.id,
    approved_at: new Date().toISOString(),
  }

  if (action === 'approve') {
    if (moderatedName) {
      if (moderatedName.length < 2 || moderatedName.length > 48) {
        throw error(400, 'Team name must be between 2 and 48 characters')
      }
      updatePayload.name = moderatedName
    }

    const finalTag = moderatedTag
    if (!finalTag || !/^[A-Za-z]{2,4}$/.test(finalTag)) {
      throw error(400, 'Approved team tag must be 2-4 letters')
    }
    updatePayload.tag = finalTag.toUpperCase()

    if (moderatedLogoPath !== null) {
      updatePayload.logo_path = moderatedLogoPath
    }
  }

  const { data: updatedTeam, error: updateError } = await supabaseAdmin
    .from('teams')
    .update(updatePayload)
    .eq('id', teamId)
    .select('id, name, tag, logo_path, approval_status, approval_notes, approved_at')
    .single()

  if (updateError || !updatedTeam) {
    if (updateError?.code === '23505') {
      throw error(409, 'Approved team name or tag conflicts with existing approved team')
    }
    throw error(500, 'Failed to update team moderation status')
  }

  await logAdminAction({
    adminProfileId: adminProfile.id,
    actionType: action === 'approve' ? 'team_approved' : 'team_rejected',
    targetTable: 'teams',
    targetId: teamId,
    details: {
      approvalNotes: notes,
      moderatedName,
      moderatedTag,
      moderatedLogoPath,
      previousStatus: existingTeam.approval_status,
      nextStatus: updatedTeam.approval_status,
    },
  })

  if (action === 'approve') {
    const { data: acceptedInvites } = await supabaseAdmin
      .from('team_invites')
      .select('invited_profile_id')
      .eq('team_id', teamId)
      .eq('status', 'accepted')

    if ((acceptedInvites ?? []).length > 0) {
      for (const invite of acceptedInvites ?? []) {
        const { data: existingMembership } = await supabaseAdmin
          .from('team_memberships')
          .select('id')
          .eq('team_id', teamId)
          .eq('profile_id', invite.invited_profile_id)
          .maybeSingle()

        if (!existingMembership) {
          await supabaseAdmin.from('team_memberships').insert({
            team_id: teamId,
            profile_id: invite.invited_profile_id,
            role: 'player',
            is_active: true,
          })
        }
      }
    }
  }

  return json({ success: true, team: updatedTeam })
}
