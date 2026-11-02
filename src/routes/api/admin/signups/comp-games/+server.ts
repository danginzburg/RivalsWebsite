import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { enforceRateLimit } from '$lib/server/rate-limit'
import { RiotLookupError } from '$lib/server/riot/henrik'
import { checkSignupGames, gamesAccountsFor } from '$lib/server/signups/comp-games'
import { normalizeOptional } from '$lib/server/signups'
import { withSignupRiotIds } from '$lib/server/signups/riot-ids'
import { supabaseAdmin } from '$lib/supabase/admin'

/** Re-count one signup's V26 competitive games and store the result. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const id = normalizeOptional(body.id)
  if (!id) throw error(400, 'Signup id is required')

  enforceRateLimit(`signups:games:${admin.id}`, {
    limit: 20,
    windowMs: 60_000,
    message: 'Too many lookups. Wait a moment before trying again.',
  })

  const { data: existing } = await supabaseAdmin
    .from('player_signups')
    .select('id, profile_id')
    .eq('id', id)
    .maybeSingle()
  if (!existing) throw error(404, 'Signup not found')

  const [signup] = await withSignupRiotIds([existing])
  const accounts = (await gamesAccountsFor([signup])).get(signup.profile_id) ?? []
  if (accounts.length === 0) throw error(400, 'This player has no Riot account to check.')

  try {
    const best = await checkSignupGames(id, accounts)
    return json({ success: true, ...best })
  } catch (err) {
    if (err instanceof RiotLookupError) throw error(err.status, err.message)
    throw err
  }
}
