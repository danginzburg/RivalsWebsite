import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'

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

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  await requireAdmin(locals.user)

  const teamId = normalizeOptional(params.id)
  if (!teamId) throw error(400, 'Missing team id')

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('teams')
    .select('id, name, tag, logo_path, metadata, status, approval_status')
    .eq('id', teamId)
    .maybeSingle()

  if (existingError || !existing) throw error(404, 'Team not found')

  const form = await request.formData().catch(() => null)
  if (!form) throw error(400, 'Invalid form data')

  const name = normalizeOptional(form.get('name'))
  const tag = normalizeOptional(form.get('tag'))
  const status = normalizeOptional(form.get('status')) ?? existing.status
  const clearLogo = String(form.get('clearLogo') ?? '').toLowerCase() === 'true'
  const logo = form.get('logo')

  if (!name || name.length < 2 || name.length > 48) {
    throw error(400, 'Team name must be 2-48 characters')
  }

  if (!tag) {
    throw error(400, 'Team tag is required')
  }

  if (!/^[A-Za-z0-9]{2,4}$/.test(tag)) {
    throw error(400, 'Team tag must be 2-4 characters (letters/numbers)')
  }

  if (!['active', 'inactive', 'disbanded'].includes(status)) {
    throw error(400, 'Invalid team status')
  }

  let logoPath = clearLogo ? null : existing.logo_path
  if (logo instanceof File && logo.size > 0) {
    const cleanName = sanitizeFilename(logo.name || 'logo')
    const objectPath = `admin/${crypto.randomUUID()}-${cleanName || 'logo'}`
    const bytes = new Uint8Array(await logo.arrayBuffer())
    const { error: uploadError } = await supabaseAdmin.storage
      .from('team-logos')
      .upload(objectPath, bytes, {
        contentType: logo.type || 'application/octet-stream',
        upsert: false,
      })
    if (uploadError) throw error(500, 'Failed to upload logo')
    logoPath = objectPath
  }

  if (!logoPath) {
    throw error(400, 'Team logo is required')
  }

  const metadata = {
    ...(existing.metadata ?? {}),
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('teams')
    .update({
      name,
      tag: tag ? tag.toUpperCase() : null,
      status,
      logo_path: logoPath,
      metadata,
    })
    .eq('id', teamId)
    .select('id, name, tag, status, logo_path, metadata')
    .single()

  if (updateError || !updated) {
    if (updateError?.code === '23505') {
      throw error(409, 'Team name or tag conflicts with another approved team')
    }
    throw error(500, 'Failed to update team')
  }

  return json({ success: true, team: updated })
}
