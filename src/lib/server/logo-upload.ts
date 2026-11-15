import { error } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { isImageFile, sanitizeFilename } from '$lib/server/upload'

export const LOGO_BUCKET = 'team-logos'

/**
 * Every object path gets a fresh UUID and is never overwritten, so the bytes
 * behind a URL never change. That lets browsers keep a logo for a year instead
 * of the Supabase default of one hour, which re-downloaded every logo on every
 * hourly visit and was most of our cached egress.
 */
export const LOGO_CACHE_CONTROL = '31536000'

/**
 * The admin UI shrinks logos to ~256px WebP before upload (see
 * `$lib/images/shrink-logo`), which lands well under this. The cap is a
 * backstop so a multi-megabyte original can't reach the CDN again.
 */
export const MAX_LOGO_BYTES = 512 * 1024

/** Upload a logo under `<folder>/<uuid>-<name>` and return its object path. */
export async function uploadLogo(folder: string, logo: File): Promise<string> {
  if (!isImageFile(logo)) throw error(400, 'Logo must be an image file')
  if (logo.size > MAX_LOGO_BYTES) {
    throw error(400, 'Logo must be 512KB or smaller (try a smaller PNG or a WebP)')
  }

  const cleanName = sanitizeFilename(logo.name || 'logo')
  const objectPath = `${folder}/${crypto.randomUUID()}-${cleanName || 'logo'}`
  const bytes = new Uint8Array(await logo.arrayBuffer())
  const { error: uploadError } = await supabaseAdmin.storage
    .from(LOGO_BUCKET)
    .upload(objectPath, bytes, {
      contentType: logo.type || 'application/octet-stream',
      cacheControl: LOGO_CACHE_CONTROL,
      upsert: false,
    })
  if (uploadError) throw error(500, 'Failed to upload logo')
  return objectPath
}
