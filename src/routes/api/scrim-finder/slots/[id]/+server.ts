import { error, json, type RequestHandler } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { expirePastSlots, matchesManageToken } from '$lib/server/scrim-finder'

export const PATCH: RequestHandler = async ({ params, request }) => {
  await expirePastSlots()

  const slotId = params.id
  if (!slotId) throw error(400, 'Missing slot id')

  const body = await request.json().catch(() => ({}))
  const action = typeof body.action === 'string' ? body.action : null
  const token = typeof body.token === 'string' ? body.token : null
  if (!action) throw error(400, 'Missing action')

  const { data: slot, error: slotError } = await supabaseAdmin
    .from('scrim_slots')
    .select('id, status, manage_token_hash')
    .eq('id', slotId)
    .maybeSingle()

  if (slotError || !slot) throw error(404, 'Scrim slot not found')
  if (!matchesManageToken(token, slot.manage_token_hash))
    throw error(403, 'Invalid management token')

  if (action !== 'cancel') {
    throw error(400, 'Unsupported action')
  }

  if (['filled', 'cancelled', 'expired'].includes(slot.status)) {
    throw error(409, 'This slot can no longer be cancelled')
  }

  const { error: cancelError } = await supabaseAdmin
    .from('scrim_slots')
    .update({ status: 'cancelled' })
    .eq('id', slot.id)

  if (cancelError) throw error(500, 'Failed to cancel slot')

  await supabaseAdmin
    .from('scrim_slot_claims')
    .update({ status: 'rejected' })
    .eq('slot_id', slot.id)
    .eq('status', 'pending')

  return json({ success: true, slot: { id: slot.id, status: 'cancelled' } })
}
