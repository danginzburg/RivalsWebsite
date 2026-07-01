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
  const ascii = name.replace(/[-￿]/g, '')
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

  const { data: accolades, error: fetchError } = await supabaseAdmin
    .from('accolades')
    .select('id, name, logo_path, icon_key, created_at')
    .order('created_at', { ascending: false })

  if (fetchError) throw error(500, 'Failed to load accolades')

  const { data: assignments, error: assignError } = await supabaseAdmin
    .from('accolade_assignments')
    .select('id, accolade_id, profile_id, context')

  if (assignError) throw error(500, 'Failed to load assignments')

  const profileIds = Array.from(
    new Set((assignments ?? []).map((a) => a.profile_id).filter(Boolean))
  )
  const profileById = new Map<string, any>()
  if (profileIds.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, riot_id_base')
      .in('id', profileIds)
    for (const p of profiles ?? []) profileById.set(p.id, p)
  }

  const assignmentsByAccolade = new Map<string, any[]>()
  for (const a of assignments ?? []) {
    const p = profileById.get(a.profile_id)
    const entry = {
      id: a.id,
      profile_id: a.profile_id,
      display_name: p?.riot_id_base ?? p?.display_name ?? 'Player',
      context: (a as any).context ?? null,
    }
    const current = assignmentsByAccolade.get(a.accolade_id) ?? []
    current.push(entry)
    assignmentsByAccolade.set(a.accolade_id, current)
  }

  const result = (accolades ?? []).map((acc: any) => ({
    ...acc,
    icon_key: acc.icon_key ?? null,
    logo_url: acc.logo_path
      ? supabaseAdmin.storage.from('team-logos').getPublicUrl(acc.logo_path).data.publicUrl
      : null,
    assignments: assignmentsByAccolade.get(acc.id) ?? [],
  }))

  return json({ accolades: result })
}

export const POST: RequestHandler = async ({ locals, request }) => {
  let uploadedLogoPath: string | null = null

  try {
    const admin = await requireAdmin(locals.user)
    const form = await request.formData().catch(() => null)
    if (!form) throw error(400, 'Invalid form data')

    const name = normalizeOptional(form.get('name'))
    const logo = form.get('logo')

    if (!name) throw error(400, 'Accolade name is required')
    if (name.length < 1 || name.length > 64) throw error(400, 'Name must be 1-64 characters')

    if (logo instanceof File && logo.size > 0) {
      if (!isImageFile(logo)) throw error(400, 'Logo must be an image file')

      const cleanName = sanitizeFilename(logo.name || 'logo')
      const objectPath = `accolades/${crypto.randomUUID()}-${cleanName || 'logo'}`
      const bytes = new Uint8Array(await logo.arrayBuffer())
      const { error: uploadError } = await supabaseAdmin.storage
        .from('team-logos')
        .upload(objectPath, bytes, {
          contentType: logo.type || 'application/octet-stream',
          upsert: false,
        })

      if (uploadError) throw error(500, 'Failed to upload accolade logo')
      uploadedLogoPath = objectPath
    }

    const { data: created, error: createError } = await supabaseAdmin
      .from('accolades')
      .insert({ name, logo_path: uploadedLogoPath })
      .select('id, name, logo_path, icon_key, created_at')
      .single()

    if (createError || !created) throw error(500, 'Failed to create accolade')

    await logAdminAction({
      adminProfileId: admin.id,
      actionType: 'accolade_created',
      targetTable: 'accolades',
      targetId: created.id,
      details: { name },
    })

    return json({
      success: true,
      accolade: {
        ...created,
        logo_url: created.logo_path
          ? supabaseAdmin.storage.from('team-logos').getPublicUrl(created.logo_path).data.publicUrl
          : null,
        assignments: [],
      },
    })
  } catch (err: any) {
    if (uploadedLogoPath) {
      await supabaseAdmin.storage.from('team-logos').remove([uploadedLogoPath])
    }
    const status = typeof err?.status === 'number' ? err.status : 500
    const message = (err?.body?.message ?? err?.message ?? 'Failed to create accolade') as string
    return json({ success: false, message }, { status })
  }
}

export const PATCH: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = await request.json()

  const accoladeId = normalizeOptional(body.accoladeId)
  const action = normalizeOptional(body.action)

  if (!accoladeId) throw error(400, 'Missing accoladeId')

  if (action === 'rename') {
    const name = normalizeOptional(body.name)
    if (!name) throw error(400, 'Name is required')

    const { error: updateError } = await supabaseAdmin
      .from('accolades')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', accoladeId)

    if (updateError) throw error(500, 'Failed to rename accolade')

    await logAdminAction({
      adminProfileId: admin.id,
      actionType: 'accolade_renamed',
      targetTable: 'accolades',
      targetId: accoladeId,
      details: { name },
    })

    return json({ success: true })
  }

  if (action === 'assign') {
    const playerName = normalizeOptional(body.playerName)
    const context = normalizeOptional(body.context)
    if (!playerName) throw error(400, 'Missing player name')

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, riot_id_base')
      .or(`riot_id_base.ilike.${playerName},display_name.ilike.${playerName}`)
      .limit(1)
      .maybeSingle()

    if (!profile) throw error(404, `No player found matching "${playerName}"`)

    const { error: insertError } = await supabaseAdmin
      .from('accolade_assignments')
      .insert({ accolade_id: accoladeId, profile_id: profile.id, context })

    if (insertError) throw error(500, 'Failed to assign accolade')

    await logAdminAction({
      adminProfileId: admin.id,
      actionType: 'accolade_assigned',
      targetTable: 'accolade_assignments',
      targetId: accoladeId,
      details: { profileId: profile.id, playerName },
    })

    const displayName = profile.riot_id_base ?? profile.display_name ?? 'Player'
    return json({
      success: true,
      assignment: { profile_id: profile.id, display_name: displayName, context },
    })
  }

  if (action === 'unassign') {
    const assignmentId = normalizeOptional(body.assignmentId)
    if (!assignmentId) throw error(400, 'Missing assignmentId')

    const { error: deleteError } = await supabaseAdmin
      .from('accolade_assignments')
      .delete()
      .eq('id', assignmentId)

    if (deleteError) throw error(500, 'Failed to unassign accolade')

    await logAdminAction({
      adminProfileId: admin.id,
      actionType: 'accolade_unassigned',
      targetTable: 'accolade_assignments',
      targetId: assignmentId,
      details: { accoladeId },
    })

    return json({ success: true })
  }

  throw error(400, 'Unsupported action')
}

export const PUT: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const form = await request.formData().catch(() => null)
  if (!form) throw error(400, 'Invalid form data')

  const accoladeId = normalizeOptional(form.get('accoladeId'))
  if (!accoladeId) throw error(400, 'Missing accoladeId')

  const { data: accolade } = await supabaseAdmin
    .from('accolades')
    .select('id, logo_path')
    .eq('id', accoladeId)
    .maybeSingle()

  if (!accolade) throw error(404, 'Accolade not found')

  const logo = form.get('logo')
  if (!(logo instanceof File) || logo.size <= 0) throw error(400, 'Logo file is required')
  if (!isImageFile(logo)) throw error(400, 'Logo must be an image file')

  if (accolade.logo_path) {
    await supabaseAdmin.storage.from('team-logos').remove([accolade.logo_path])
  }

  const cleanName = sanitizeFilename(logo.name || 'logo')
  const objectPath = `accolades/${crypto.randomUUID()}-${cleanName || 'logo'}`
  const bytes = new Uint8Array(await logo.arrayBuffer())
  const { error: uploadError } = await supabaseAdmin.storage
    .from('team-logos')
    .upload(objectPath, bytes, {
      contentType: logo.type || 'application/octet-stream',
      upsert: false,
    })

  if (uploadError) throw error(500, 'Failed to upload logo')

  const { error: updateError } = await supabaseAdmin
    .from('accolades')
    .update({ logo_path: objectPath, updated_at: new Date().toISOString() })
    .eq('id', accoladeId)

  if (updateError) throw error(500, 'Failed to update accolade logo')

  const logo_url = supabaseAdmin.storage.from('team-logos').getPublicUrl(objectPath).data.publicUrl

  await logAdminAction({
    adminProfileId: admin.id,
    actionType: 'accolade_logo_updated',
    targetTable: 'accolades',
    targetId: accoladeId,
    details: { logoPath: objectPath },
  })

  return json({ success: true, logo_url })
}

export const DELETE: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = await request.json()
  const accoladeId = normalizeOptional(body.accoladeId)

  if (!accoladeId) throw error(400, 'Missing accoladeId')

  const { data: accolade } = await supabaseAdmin
    .from('accolades')
    .select('id, name, logo_path')
    .eq('id', accoladeId)
    .maybeSingle()

  if (!accolade) throw error(404, 'Accolade not found')

  if (accolade.logo_path) {
    await supabaseAdmin.storage.from('team-logos').remove([accolade.logo_path])
  }

  const { error: deleteError } = await supabaseAdmin.from('accolades').delete().eq('id', accoladeId)

  if (deleteError) throw error(500, 'Failed to delete accolade')

  await logAdminAction({
    adminProfileId: admin.id,
    actionType: 'accolade_deleted',
    targetTable: 'accolades',
    targetId: accoladeId,
    details: { name: accolade.name },
  })

  return json({ success: true })
}
