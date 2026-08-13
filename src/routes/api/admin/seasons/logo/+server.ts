import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { logAdminAction } from '$lib/server/audit/admin-actions'
import { isImageFile, sanitizeFilename } from '$lib/server/upload'
import { getSeasonLogoUrl } from '$lib/server/seasons/logo'

const MAX_LOGO_BYTES = 2 * 1024 * 1024

/** Upload or replace a season's logo. Multipart, so it cannot share the JSON route. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)

  const form = await request.formData().catch(() => null)
  if (!form) throw error(400, 'Invalid form data')

  const seasonId = typeof form.get('seasonId') === 'string' ? String(form.get('seasonId')) : ''
  if (!seasonId) throw error(400, 'Season id is required')

  const logo = form.get('logo')
  if (!(logo instanceof File) || logo.size <= 0) throw error(400, 'A logo file is required')
  if (!isImageFile(logo)) throw error(400, 'Logo must be an image file')
  if (logo.size > MAX_LOGO_BYTES) throw error(400, 'Logo must be 2MB or smaller')

  const { data: season } = await supabaseAdmin
    .from('seasons')
    .select('id, name, logo_path')
    .eq('id', seasonId)
    .maybeSingle()

  if (!season) throw error(404, 'Season not found')

  const cleanName = sanitizeFilename(logo.name || 'logo')
  const objectPath = `seasons/${crypto.randomUUID()}-${cleanName || 'logo'}`
  const bytes = new Uint8Array(await logo.arrayBuffer())

  const { error: uploadError } = await supabaseAdmin.storage
    .from('team-logos')
    .upload(objectPath, bytes, {
      contentType: logo.type || 'application/octet-stream',
      upsert: false,
    })

  if (uploadError) throw error(500, 'Failed to upload season logo')

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('seasons')
    .update({ logo_path: objectPath })
    .eq('id', seasonId)
    .select('id, logo_path')
    .single()

  if (updateError) {
    // Do not leave the uploaded object behind if the row could not be pointed at it.
    await supabaseAdmin.storage.from('team-logos').remove([objectPath])
    throw error(500, 'Failed to save season logo')
  }

  // Best effort: the new logo is already live, so a failed cleanup is not fatal.
  if (season.logo_path) {
    await supabaseAdmin.storage.from('team-logos').remove([season.logo_path])
  }

  await logAdminAction({
    adminProfileId: admin.id,
    actionType: 'season_logo_updated',
    targetTable: 'seasons',
    targetId: seasonId,
    details: { logoPath: objectPath },
  })

  return json({ success: true, logoPath: objectPath, logoUrl: getSeasonLogoUrl(updated) })
}

/** Remove a season's logo. */
export const DELETE: RequestHandler = async ({ locals, url }) => {
  const admin = await requireAdmin(locals.user)

  const seasonId = url.searchParams.get('seasonId')
  if (!seasonId) throw error(400, 'Season id is required')

  const { data: season } = await supabaseAdmin
    .from('seasons')
    .select('id, logo_path')
    .eq('id', seasonId)
    .maybeSingle()

  if (!season) throw error(404, 'Season not found')

  const { error: updateError } = await supabaseAdmin
    .from('seasons')
    .update({ logo_path: null })
    .eq('id', seasonId)

  if (updateError) throw error(500, 'Failed to remove season logo')

  if (season.logo_path) {
    await supabaseAdmin.storage.from('team-logos').remove([season.logo_path])
  }

  await logAdminAction({
    adminProfileId: admin.id,
    actionType: 'season_logo_removed',
    targetTable: 'seasons',
    targetId: seasonId,
    details: {},
  })

  return json({ success: true })
}
