import { error } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { expirePastSlots, mapPublicSlot } from '$lib/server/scrim-finder'

export const load = async () => {
  await expirePastSlots()

  const { data: slots, error: slotsError } = await supabaseAdmin
    .from('scrim_slots')
    .select(
      `
      id,
      slot_type,
      status,
      team_name,
      rep_name,
      discord_handle,
      target_team_name,
      scheduled_at,
      notes,
      created_at,
      accepted_claim:scrim_slot_claims!scrim_slots_accepted_claim_id_fkey (
        id,
        team_name,
        rep_name,
        discord_handle,
        message,
        created_at
      )
    `
    )
    .in('status', ['open', 'pending_selection', 'filled'])
    .order('scheduled_at', { ascending: true })
    .order('created_at', { ascending: false })

  if (slotsError) throw error(500, 'Failed to load scrim slots')

  const slotIds = (slots ?? []).map((slot) => slot.id)
  const pendingBySlot = new Map<string, number>()
  if (slotIds.length > 0) {
    const { data: pendingClaims, error: pendingClaimsError } = await supabaseAdmin
      .from('scrim_slot_claims')
      .select('slot_id')
      .in('slot_id', slotIds)
      .eq('status', 'pending')

    if (pendingClaimsError) throw error(500, 'Failed to load scrim claim counts')

    for (const claim of pendingClaims ?? []) {
      pendingBySlot.set(claim.slot_id, (pendingBySlot.get(claim.slot_id) ?? 0) + 1)
    }
  }

  const normalizedSlots = (slots ?? []).map((slot) =>
    mapPublicSlot({
      ...slot,
      pendingClaimsCount: pendingBySlot.get(slot.id) ?? 0,
    })
  )

  return {
    slots: normalizedSlots,
  }
}
