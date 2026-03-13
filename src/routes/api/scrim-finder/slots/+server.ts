import { error, json, type RequestHandler } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import {
  buildManageUrl,
  ensureFutureScheduledAt,
  expirePastSlots,
  generateManageToken,
  mapPublicSlot,
  normalizeDiscordHandle,
  normalizeNotes,
  normalizeRepName,
  normalizeSlotType,
  normalizeTargetTeamName,
  normalizeTeamName,
  parseScheduledAt,
} from '$lib/server/scrim-finder'

export const POST: RequestHandler = async ({ request, url }) => {
  await expirePastSlots()

  const body = await request.json().catch(() => ({}))
  const teamName = normalizeTeamName(body.teamName)
  const repName = normalizeRepName(body.repName)
  const discordHandle = normalizeDiscordHandle(body.discordHandle)
  const slotType = normalizeSlotType(body.slotType)
  const targetTeamName = normalizeTargetTeamName(slotType, body.targetTeamName)
  const notes = normalizeNotes(body.notes)
  const scheduledAt = parseScheduledAt(body.scheduledAt)
  ensureFutureScheduledAt(scheduledAt)

  const { token, tokenHash } = generateManageToken()

  const { data: created, error: createError } = await supabaseAdmin
    .from('scrim_slots')
    .insert({
      slot_type: slotType,
      status: 'open',
      team_name: teamName,
      rep_name: repName,
      discord_handle: discordHandle,
      target_team_name: targetTeamName,
      scheduled_at: scheduledAt,
      notes,
      manage_token_hash: tokenHash,
    })
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
      created_at
    `
    )
    .single()

  if (createError || !created) {
    throw error(500, createError?.message || 'Failed to create scrim slot')
  }

  return json(
    {
      success: true,
      slot: mapPublicSlot(created),
      manageUrl: buildManageUrl(url.origin, token),
    },
    { status: 201 }
  )
}
