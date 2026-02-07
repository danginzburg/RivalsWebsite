import { error, json, type RequestHandler } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { requireAdmin } from '$lib/server/auth/profile'
import { logAdminAction } from '$lib/server/audit/admin-actions'

function normalizePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const DELETE: RequestHandler = async ({ locals, request }) => {
  const adminProfile = await requireAdmin(locals.user)
  const { path } = await request.json()
  const normalizedPath = normalizePath(path)

  if (!normalizedPath) {
    throw error(400, 'Missing logo path')
  }

  const { error: removeError } = await supabaseAdmin.storage
    .from('team-logos')
    .remove([normalizedPath])
  if (removeError) {
    throw error(500, 'Failed to remove logo')
  }

  await logAdminAction({
    adminProfileId: adminProfile.id,
    actionType: 'team_logo_removed',
    targetTable: 'storage.objects',
    targetId: normalizedPath,
    details: {
      bucket: 'team-logos',
      path: normalizedPath,
    },
  })

  return json({ success: true })
}
