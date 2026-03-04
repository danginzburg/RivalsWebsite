import { error, json, type RequestHandler } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { requireAdmin } from '$lib/server/auth/profile'
import { logAdminAction } from '$lib/server/audit/admin-actions'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function sanitizeFilename(name: string): string {
  const ascii = name.replace(/[\u0080-\uFFFF]/g, '')
  return ascii
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 80)
}

function isImageFile(file: File) {
  return typeof file.type === 'string' && file.type.startsWith('image/')
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

  const captainMap = new Map<string, { display_name: string | null; email: string | null }>()
  const rosterMap = new Map<
    string,
    Array<{
      profile_id: string
      role: string
      riot_id_base: string | null
      display_name: string | null
      email: string | null
    }>
  >()
  const rosterCountMap = new Map<string, number>()

  if (approvedTeamIds.length > 0) {
    const { data: rosterRows, error: rosterError } = await supabaseAdmin
      .from('team_memberships')
      .select('team_id, profile_id, role')
      .in('team_id', approvedTeamIds)
      .eq('is_active', true)
      .is('left_at', null)

    if (rosterError) throw error(500, 'Failed to load team rosters')

    const profileIds = Array.from(new Set((rosterRows ?? []).map((r) => r.profile_id)))

    const profileById = new Map<string, any>()
    if (profileIds.length > 0) {
      const { data: profileRows, error: profilesError } = await supabaseAdmin
        .from('profiles')
        .select('id, display_name, email, riot_id_base')
        .in('id', profileIds)

      if (profilesError) throw error(500, 'Failed to load roster profiles')
      for (const p of profileRows ?? []) profileById.set(p.id, p)
    }

    for (const row of rosterRows ?? []) {
      rosterCountMap.set(row.team_id, (rosterCountMap.get(row.team_id) ?? 0) + 1)
      const p = profileById.get(row.profile_id)
      const entry = {
        profile_id: row.profile_id,
        role: row.role,
        riot_id_base: p?.riot_id_base ?? null,
        display_name: p?.display_name ?? null,
        email: p?.email ?? null,
      }
      const current = rosterMap.get(row.team_id) ?? []
      current.push(entry)
      rosterMap.set(row.team_id, current)
      if (row.role === 'captain') {
        captainMap.set(row.team_id, {
          display_name: p?.display_name ?? null,
          email: p?.email ?? null,
        })
      }
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

export const POST: RequestHandler = async ({ locals, request }) => {
  let uploadedLogoPath: string | null = null

  try {
    const adminProfile = await requireAdmin(locals.user)

    const form = await request.formData().catch(() => null)
    if (!form) throw error(400, 'Invalid form data')

    const name = normalizeOptional(form.get('name'))
    const tag = normalizeOptional(form.get('tag'))
    const logo = form.get('logo')

    if (!name) throw error(400, 'Team name is required')
    if (name.length < 2 || name.length > 48) throw error(400, 'Team name must be 2-48 characters')

    if (tag && !/^[A-Za-z0-9]{2,4}$/.test(tag)) {
      throw error(400, 'Team tag must be 2-4 characters (letters/numbers)')
    }

    if (logo instanceof File && logo.size > 0) {
      if (!isImageFile(logo)) throw error(400, 'Logo must be an image file')

      const cleanName = sanitizeFilename(logo.name || 'logo')
      const objectPath = `admin/${crypto.randomUUID()}-${cleanName || 'logo'}`
      const bytes = new Uint8Array(await logo.arrayBuffer())
      const { error: uploadError } = await supabaseAdmin.storage
        .from('team-logos')
        .upload(objectPath, bytes, {
          contentType: logo.type || 'application/octet-stream',
          upsert: false,
        })

      if (uploadError) {
        throw error(500, 'Failed to upload team logo')
      }
      uploadedLogoPath = objectPath
    }

    const now = new Date().toISOString()
    const { data: created, error: createError } = await supabaseAdmin
      .from('teams')
      .insert({
        name,
        tag: tag ? tag.toUpperCase() : null,
        logo_path: uploadedLogoPath,
        status: 'active',
        approval_status: 'approved',
        approval_notes: 'Created by administrator',
        submitted_by_profile_id: adminProfile.id,
        approved_by_profile_id: adminProfile.id,
        approved_at: now,
      })
      .select('id, name, tag, logo_path, approval_status, created_at')
      .single()

    if (createError || !created) {
      if (createError?.code === '23505') {
        throw error(409, 'Team name or tag conflicts with an existing approved team')
      }
      throw error(500, createError?.message || 'Failed to create team')
    }

    await logAdminAction({
      adminProfileId: adminProfile.id,
      actionType: 'team_created',
      targetTable: 'teams',
      targetId: created.id,
      details: {
        name: created.name,
        tag: created.tag,
      },
    })

    return json({ success: true, team: created })
  } catch (err: any) {
    if (uploadedLogoPath) {
      await supabaseAdmin.storage.from('team-logos').remove([uploadedLogoPath])
    }

    const status = typeof err?.status === 'number' ? err.status : 500
    const message = (err?.body?.message ?? err?.message ?? 'Failed to create team') as string
    return json({ success: false, message }, { status })
  }
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
    if (!finalTag || !/^[A-Za-z0-9]{2,4}$/.test(finalTag)) {
      throw error(400, 'Approved team tag must be 2-4 characters (letters/numbers)')
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
