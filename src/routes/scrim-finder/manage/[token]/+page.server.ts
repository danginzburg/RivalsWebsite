import { error } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { expirePastSlots, hashManageToken, mapPublicSlot } from '$lib/server/scrim-finder'

export const load = async ({ params, url }: { params: { token: string }; url: URL }) => {
  await expirePastSlots()

  const token = params.token
  if (!token) throw error(404, 'Manage link not found')
  const tokenHash = hashManageToken(token)

  const claimId = url.searchParams.get('claim')
  if (claimId) {
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
        slot:scrim_slots!scrim_slot_claims_slot_id_fkey (
          id,
          slot_type,
          status,
          team_name,
          rep_name,
          discord_handle,
          target_team_name,
          scheduled_at,
          notes,
          created_at
        )
      `
      )
      .eq('id', claimId)
      .eq('manage_token_hash', tokenHash)
      .maybeSingle()

    if (claimError || !claim || !claim.slot) throw error(404, 'Manage link not found')

    return {
      mode: 'claim',
      slot: mapPublicSlot(claim.slot),
      claim: {
        id: claim.id,
        slotId: claim.slot_id,
        status: claim.status,
        teamName: claim.team_name,
        repName: claim.rep_name,
        discordHandle: claim.discord_handle,
        message: claim.message,
        createdAt: claim.created_at,
      },
      claimToken: token,
      slotToken: null,
      claims: [],
    }
  }

  const { data: slot, error: slotError } = await supabaseAdmin
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
    .eq('manage_token_hash', tokenHash)
    .maybeSingle()

  if (slotError || !slot) throw error(404, 'Manage link not found')

  const { data: claims, error: claimsError } = await supabaseAdmin
    .from('scrim_slot_claims')
    .select('id, status, team_name, rep_name, discord_handle, message, created_at')
    .eq('slot_id', slot.id)
    .order('created_at', { ascending: true })

  if (claimsError) throw error(500, 'Failed to load slot claims')

  return {
    mode: 'slot',
    slot: mapPublicSlot({
      ...slot,
      pendingClaimsCount: (claims ?? []).filter((claim) => claim.status === 'pending').length,
    }),
    claims: (claims ?? []).map((claim) => ({
      id: claim.id,
      status: claim.status,
      teamName: claim.team_name,
      repName: claim.rep_name,
      discordHandle: claim.discord_handle,
      message: claim.message,
      createdAt: claim.created_at,
    })),
    slotToken: token,
    claimToken: null,
    claim: null,
  }
}
