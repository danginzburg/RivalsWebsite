import { error, json, type RequestHandler } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import {
  buildManageUrl,
  ensureFutureScheduledAt,
  expirePastSlots,
  generateManageToken,
  isSameTeamName,
  normalizeDiscordHandle,
  normalizeNotes,
  normalizeRepName,
  normalizeTeamName,
} from '$lib/server/scrim-finder'

export const POST: RequestHandler = async ({ params, request, url }) => {
  await expirePastSlots()

  const slotId = params.id
  if (!slotId) throw error(400, 'Missing slot id')

  const { data: slot, error: slotError } = await supabaseAdmin
    .from('scrim_slots')
    .select('id, slot_type, status, team_name, target_team_name, scheduled_at')
    .eq('id', slotId)
    .maybeSingle()

  if (slotError || !slot) throw error(404, 'Scrim slot not found')
  if (!['open', 'pending_selection'].includes(slot.status)) {
    throw error(409, 'This slot is no longer accepting claims')
  }
  ensureFutureScheduledAt(slot.scheduled_at)

  const body = await request.json().catch(() => ({}))
  const teamName = normalizeTeamName(body.teamName)
  const repName = normalizeRepName(body.repName)
  const discordHandle = normalizeDiscordHandle(body.discordHandle)
  const message = normalizeNotes(body.message, 'Message')

  if (isSameTeamName(teamName, slot.team_name)) {
    throw error(400, 'Claiming team must be different from posting team')
  }
  if (slot.slot_type === 'targeted' && !isSameTeamName(teamName, slot.target_team_name)) {
    throw error(403, 'This slot is targeted to another team')
  }

  const { token, tokenHash } = generateManageToken()

  const { data: created, error: createError } = await supabaseAdmin
    .from('scrim_slot_claims')
    .insert({
      slot_id: slot.id,
      status: 'pending',
      team_name: teamName,
      rep_name: repName,
      discord_handle: discordHandle,
      message,
      manage_token_hash: tokenHash,
    })
    .select('id, slot_id, status, team_name, rep_name, discord_handle, message, created_at')
    .single()

  if (createError || !created) {
    if (createError?.code === '23505') {
      throw error(409, 'Your team already has a pending claim on this slot')
    }
    throw error(500, createError?.message || 'Failed to submit claim')
  }

  if (slot.status === 'open') {
    await supabaseAdmin
      .from('scrim_slots')
      .update({ status: 'pending_selection' })
      .eq('id', slot.id)
  }

  return json(
    {
      success: true,
      claim: {
        id: created.id,
        slotId: created.slot_id,
        status: created.status,
        teamName: created.team_name,
        repName: created.rep_name,
        discordHandle: created.discord_handle,
        message: created.message,
        createdAt: created.created_at,
      },
      manageUrl: `${url.origin}/scrim-finder/manage/${token}?claim=${created.id}`,
    },
    { status: 201 }
  )
}
