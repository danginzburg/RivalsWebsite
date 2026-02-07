import { error, json, type RequestHandler } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { requireAdmin } from '$lib/server/auth/profile'
import { TEAM_BALANCE_RANKS } from '$lib/team-balance'
import { logAdminAction } from '$lib/server/audit/admin-actions'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const PATCH: RequestHandler = async ({ locals, request }) => {
  const adminProfile = await requireAdmin(locals.user)
  const body = await request.json()

  const registrationId = body.registrationId
  const rankLabel = normalizeOptional(body.rankLabel)

  if (!registrationId || typeof registrationId !== 'number') {
    throw error(400, 'registrationId is required')
  }

  if (!rankLabel) {
    throw error(400, 'rankLabel is required')
  }

  const rank = TEAM_BALANCE_RANKS.find((entry) => entry.name === rankLabel)
  if (!rank) {
    throw error(400, 'Invalid rank label')
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('player_registration')
    .update({
      rank_label: rank.name,
      rank_value: rank.value,
      rank_updated_at: new Date().toISOString(),
      rank_updated_by_profile_id: adminProfile.id,
    })
    .eq('id', registrationId)
    .select('id, rank_label, rank_value')
    .single()

  if (updateError || !updated) {
    throw error(500, 'Failed to update player rank')
  }

  await logAdminAction({
    adminProfileId: adminProfile.id,
    actionType: 'player_rank_updated',
    targetTable: 'player_registration',
    targetId: String(registrationId),
    details: {
      rankLabel: updated.rank_label,
      rankValue: updated.rank_value,
    },
  })

  return json({ success: true, player: updated })
}
