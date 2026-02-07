import { error, json, type RequestHandler } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { requireProfile } from '$lib/server/auth/profile'

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase()
}

export const POST: RequestHandler = async ({ locals, request }) => {
  const profile = await requireProfile(locals.user)
  const formData = await request.formData()
  const file = formData.get('file')

  if (!(file instanceof File)) {
    throw error(400, 'Missing file upload')
  }

  if (file.size <= 0 || file.size > MAX_FILE_SIZE_BYTES) {
    throw error(400, 'File must be between 1 byte and 5MB')
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw error(400, 'Unsupported file type')
  }

  const bytes = await file.arrayBuffer()
  const path = `${profile.id}/${Date.now()}-${sanitizeFilename(file.name)}`

  const { error: uploadError } = await supabaseAdmin.storage
    .from('team-logos')
    .upload(path, bytes, { contentType: file.type, upsert: false })

  if (uploadError) {
    throw error(500, 'Failed to upload logo')
  }

  const { data: publicUrlData } = supabaseAdmin.storage.from('team-logos').getPublicUrl(path)

  return json({
    success: true,
    path,
    publicUrl: publicUrlData.publicUrl,
  })
}
