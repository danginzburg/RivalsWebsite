import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { logAdminAction } from '$lib/server/audit/admin-actions'
import { supabaseAdmin } from '$lib/supabase/admin'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const POST: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))
  const userId = normalizeOptional(body.userId)

  if (!userId) throw error(400, 'userId is required')
  if (userId === admin.id) throw error(400, 'You cannot purge yourself')

  const { data: target, error: targetError } = await supabaseAdmin
    .from('profiles')
    .select('id, role')
    .eq('id', userId)
    .single()

  if (targetError || !target) throw error(404, 'Target user not found')
  if (target.role === 'admin') throw error(403, 'Cannot purge an admin user')

  // Remove user from participation lists.
  const { error: invitesError } = await supabaseAdmin
    .from('team_invites')
    .delete()
    .or(`invited_profile_id.eq.${userId},invited_by_profile_id.eq.${userId}`)
  if (invitesError) throw error(500, 'Failed to remove team invites')

  const { error: observerError } = await supabaseAdmin
    .from('observer_registration')
    .delete()
    .eq('profile_id', userId)
  if (observerError) throw error(500, 'Failed to remove observer registration')

  // player_registration deletion cascades to team_memberships + free_agent_listings.
  const { error: playerError } = await supabaseAdmin
    .from('player_registration')
    .delete()
    .eq('profile_id', userId)
  if (playerError) throw error(500, 'Failed to remove player registration')

  // Optional cleanups for result reports (if table exists)
  await supabaseAdmin.from('match_result_reports').delete().eq('reported_by_profile_id', userId)

  await logAdminAction({
    adminProfileId: admin.id,
    actionType: 'user_purged_from_lists',
    targetTable: 'profiles',
    targetId: userId,
  })

  return json({ success: true })
}
