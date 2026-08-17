import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { claimRelinkAfterProfileUpdate } from '$lib/server/players/claim-relink'

/**
 * Admin review of alternate Riot accounts. Approving pools the alt's historic
 * stats into the owning profile via the same relink used when a Riot ID is set.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  await requireAdmin(locals.user)

  const status = url.searchParams.get('status') ?? 'pending'

  let query = supabaseAdmin
    .from('profile_riot_accounts')
    .select(
      'id, profile_id, riot_name, riot_tag, riot_puuid, is_primary, status, label, created_at'
    )
    .eq('is_primary', false)
    .order('created_at', { ascending: true })
    .limit(500)

  if (status !== 'all') query = query.eq('status', status)

  const { data: accounts, error: listError } = await query
  if (listError) throw error(500, 'Failed to load Riot accounts')

  const rows = accounts ?? []
  if (rows.length === 0) return json({ accounts: [] })

  // Attach the owning player's name so the admin knows who is claiming the alt.
  const profileIds = Array.from(new Set(rows.map((r) => r.profile_id)))
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, riot_id_base, email')
    .in('id', profileIds)

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]))

  return json({
    accounts: rows.map((row) => {
      const profile = profileById.get(row.profile_id)
      return {
        ...row,
        profile: {
          id: row.profile_id,
          name:
            profile?.display_name ?? profile?.riot_id_base ?? profile?.email ?? 'Unknown player',
        },
      }
    }),
  })
}

export const PATCH: RequestHandler = async ({ locals, request }) => {
  await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const id = typeof body.id === 'string' ? body.id : null
  const status = typeof body.status === 'string' ? body.status : null
  if (!id) throw error(400, 'Account id is required')
  if (!status || !['approved', 'rejected', 'pending'].includes(status)) {
    throw error(400, 'status must be approved, rejected, or pending')
  }

  const { data: account, error: loadError } = await supabaseAdmin
    .from('profile_riot_accounts')
    .select('id, profile_id, is_primary')
    .eq('id', id)
    .maybeSingle()

  if (loadError || !account) throw error(404, 'Riot account not found')
  if (account.is_primary) throw error(400, 'The primary account cannot be reviewed.')

  const { error: updateError } = await supabaseAdmin
    .from('profile_riot_accounts')
    .update({
      status,
      verified_at: status === 'approved' ? new Date().toISOString() : null,
    })
    .eq('id', id)

  if (updateError) throw error(500, 'Failed to update Riot account')

  // Approving links the alt's historic match/leaderboard rows into the profile.
  let relink: Awaited<ReturnType<typeof claimRelinkAfterProfileUpdate>> | null = null
  if (status === 'approved') {
    try {
      relink = await claimRelinkAfterProfileUpdate(account.profile_id)
    } catch (err) {
      console.warn('claimRelinkAfterProfileUpdate failed after alt approval:', err)
    }
  }

  return json({ success: true, relink })
}
