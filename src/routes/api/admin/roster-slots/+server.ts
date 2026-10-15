import { error, json, type RequestHandler } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { requireAdmin } from '$lib/server/auth/profile'
import { logAdminAction } from '$lib/server/audit/admin-actions'

/**
 * Delete a mis-entered roster slot outright.
 *
 * For a name-only slot whose player is already on the roster under a properly
 * linked slot (a typo, or a handle re-entered as a Riot ID). Closing it would
 * leave a false departure in the team history and keep it in sub detection, so
 * the row is removed instead. Only slots with neither a PUUID nor a profile can
 * go this way; anything linked is a real roster spot and is removed through the
 * team roster. The full row is written to the admin log so it can be restored.
 */
export const DELETE: RequestHandler = async ({ locals, request }) => {
  const adminProfile = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))
  const membershipId = Number(body.membershipId)
  if (!Number.isFinite(membershipId)) throw error(400, 'Missing membershipId')

  const { data: slot, error: slotError } = await supabaseAdmin
    .from('team_memberships')
    .select('*')
    .eq('id', membershipId)
    .maybeSingle()

  if (slotError) throw error(500, 'Failed to load roster slot')
  if (!slot) throw error(404, 'Roster slot not found')
  if (slot.puuid || slot.profile_id) {
    throw error(409, 'That slot is linked to a player; remove it from the team roster instead')
  }

  const { error: deleteError } = await supabaseAdmin
    .from('team_memberships')
    .delete()
    .eq('id', membershipId)
  if (deleteError) throw error(500, 'Failed to remove roster slot')

  await logAdminAction({
    adminProfileId: adminProfile.id,
    actionType: 'roster_slot_deleted',
    targetTable: 'team_memberships',
    targetId: String(membershipId),
    details: { teamId: slot.team_id, playerName: slot.player_name ?? null, row: slot },
  })

  return json({ success: true })
}
