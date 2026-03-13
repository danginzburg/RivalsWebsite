import { error, json, type RequestHandler } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import {
  countPendingClaims,
  ensureFutureScheduledAt,
  expirePastSlots,
  matchesManageToken,
} from '$lib/server/scrim-finder'

export const PATCH: RequestHandler = async ({ params, request }) => {
  await expirePastSlots()

  const claimId = params.id
  if (!claimId) throw error(400, 'Missing claim id')

  const body = await request.json().catch(() => ({}))
  const action = typeof body.action === 'string' ? body.action : null
  const claimToken = typeof body.claimToken === 'string' ? body.claimToken : null
  const slotToken = typeof body.slotToken === 'string' ? body.slotToken : null
  if (!action) throw error(400, 'Missing action')

  const { data: claim, error: claimError } = await supabaseAdmin
    .from('scrim_slot_claims')
    .select(
      `
      id,
      slot_id,
      status,
      team_name,
      rep_name,
      discord_handle,
      message,
      created_at,
      manage_token_hash
    `
    )
    .eq('id', claimId)
    .maybeSingle()

  if (claimError || !claim) throw error(404, 'Claim not found')
  const { data: slot, error: slotError } = await supabaseAdmin
    .from('scrim_slots')
    .select('id, status, scheduled_at, manage_token_hash, accepted_claim_id')
    .eq('id', claim.slot_id)
    .maybeSingle()

  if (slotError || !slot) throw error(404, 'Slot not found')
  ensureFutureScheduledAt(slot.scheduled_at)

  if (action === 'withdraw') {
    if (!matchesManageToken(claimToken, claim.manage_token_hash)) {
      throw error(403, 'Invalid claim management token')
    }
    if (claim.status !== 'pending') throw error(409, 'Only pending claims can be withdrawn')

    const { error: withdrawError } = await supabaseAdmin
      .from('scrim_slot_claims')
      .update({ status: 'withdrawn' })
      .eq('id', claim.id)

    if (withdrawError) throw error(500, 'Failed to withdraw claim')

    const pendingCount = await countPendingClaims(claim.slot_id)
    if (pendingCount === 0 && slot.status === 'pending_selection') {
      await supabaseAdmin.from('scrim_slots').update({ status: 'open' }).eq('id', claim.slot_id)
    }

    return json({ success: true, claim: { id: claim.id, status: 'withdrawn' } })
  }

  if (!['accept', 'reject'].includes(action)) {
    throw error(400, 'Unsupported action')
  }
  if (!matchesManageToken(slotToken, slot.manage_token_hash)) {
    throw error(403, 'Invalid slot management token')
  }
  if (claim.status !== 'pending') throw error(409, 'Only pending claims can be updated')
  if (!['open', 'pending_selection'].includes(slot.status)) {
    throw error(409, 'Slot is no longer accepting claims')
  }

  if (action === 'reject') {
    const { error: rejectError } = await supabaseAdmin
      .from('scrim_slot_claims')
      .update({ status: 'rejected' })
      .eq('id', claim.id)
      .eq('status', 'pending')

    if (rejectError) throw error(500, 'Failed to reject claim')

    const pendingCount = await countPendingClaims(claim.slot_id)
    if (pendingCount === 0) {
      await supabaseAdmin.from('scrim_slots').update({ status: 'open' }).eq('id', claim.slot_id)
    }

    return json({ success: true, claim: { id: claim.id, status: 'rejected' } })
  }

  if (slot.accepted_claim_id) {
    throw error(409, 'A claim is already accepted for this slot')
  }

  const { error: acceptError } = await supabaseAdmin
    .from('scrim_slot_claims')
    .update({ status: 'accepted' })
    .eq('id', claim.id)
    .eq('status', 'pending')

  if (acceptError) {
    if (acceptError.code === '23505') throw error(409, 'A claim is already accepted for this slot')
    throw error(500, 'Failed to accept claim')
  }

  const { error: slotUpdateError } = await supabaseAdmin
    .from('scrim_slots')
    .update({ status: 'filled', accepted_claim_id: claim.id })
    .eq('id', claim.slot_id)

  if (slotUpdateError) throw error(500, 'Failed to finalize slot')

  await supabaseAdmin
    .from('scrim_slot_claims')
    .update({ status: 'rejected' })
    .eq('slot_id', claim.slot_id)
    .eq('status', 'pending')
    .neq('id', claim.id)

  return json({
    success: true,
    claim: {
      id: claim.id,
      status: 'accepted',
      teamName: claim.team_name,
      repName: claim.rep_name,
      discordHandle: claim.discord_handle,
      message: claim.message,
      createdAt: claim.created_at,
    },
    slot: { id: claim.slot_id, status: 'filled', acceptedClaimId: claim.id },
  })
}
