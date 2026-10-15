import { error, json, type RequestHandler } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { requireAdmin } from '$lib/server/auth/profile'
import { logAdminAction } from '$lib/server/audit/admin-actions'

/**
 * Hide (or restore) a team's former-player entry.
 *
 * For departures that are really duplicates: the same player entered twice
 * under different names, or a mis-typed handle. The closed stints stay in
 * place, because sub detection still judges past matches by the roster that
 * stood when they were played; only `metadata.hidden_from_history` changes, and
 * the team page leaves flagged rows out of its Former players list.
 */
export const PATCH: RequestHandler = async ({ locals, request }) => {
  const adminProfile = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))
  const teamId = typeof body.teamId === 'string' ? body.teamId : ''
  const hidden = body.hidden !== false
  const membershipIds = Array.isArray(body.membershipIds)
    ? body.membershipIds.map(Number).filter(Number.isFinite)
    : []
  if (!teamId || membershipIds.length === 0) throw error(400, 'Missing teamId or membershipIds')

  const { data: rows, error: rowsError } = await supabaseAdmin
    .from('team_memberships')
    .select('id, metadata, left_at, player_name')
    .eq('team_id', teamId)
    .in('id', membershipIds)
  if (rowsError) throw error(500, 'Failed to load former players')
  if (!rows || rows.length !== membershipIds.length) throw error(404, 'Former player not found')
  // Open rows are the live roster; they're managed through the team itself.
  if (rows.some((row) => !row.left_at)) throw error(409, 'That player is still on the roster')

  const results = await Promise.all(
    rows.map((row) => {
      const metadata = { ...((row.metadata as Record<string, unknown> | null) ?? {}) }
      if (hidden) metadata.hidden_from_history = true
      else delete metadata.hidden_from_history
      return supabaseAdmin.from('team_memberships').update({ metadata }).eq('id', row.id)
    })
  )
  if (results.some((r) => r.error)) throw error(500, 'Failed to update former player')

  await logAdminAction({
    adminProfileId: adminProfile.id,
    actionType: hidden ? 'former_player_hidden' : 'former_player_restored',
    targetTable: 'team_memberships',
    targetId: membershipIds.join(','),
    details: { teamId, playerNames: rows.map((r) => r.player_name ?? null) },
  })

  return json({ success: true })
}
