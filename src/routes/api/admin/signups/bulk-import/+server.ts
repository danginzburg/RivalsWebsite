import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { enforceRateLimit } from '$lib/server/rate-limit'
import { lookupSignupRank } from '$lib/server/riot/henrik'
import { linkedPuuidsFor } from '$lib/server/players/riot-accounts'
import {
  MAX_BULK_ROWS,
  runBulkImport,
  type BulkSignupRow,
  type SignupPatch,
} from '$lib/server/signups/bulk-import'
import { loadRatingsByName, ratingNameKey } from '$lib/server/signups/ratings'

/**
 * Fill current and peak ranks for many signups.
 *
 * One call works through the filtered list from `cursor` until its time budget
 * or the HenrikDev rate limit stops it, then returns `nextCursor`; the admin
 * page keeps calling until that is null. The HenrikDev client paces every
 * request, so a list of any size finishes without tripping the API's limit —
 * it just takes a few minutes for a few hundred players.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const overwrite = body.overwrite === true
  const status = typeof body.status === 'string' && body.status ? body.status : 'pending'
  const seasonId = typeof body.seasonId === 'string' ? body.seasonId : null
  const cursor = Number.isInteger(body.cursor) && body.cursor > 0 ? (body.cursor as number) : 0

  // Only a fresh run counts: continuation calls are one run split across
  // requests, and a few hundred players need a dozen or more of them.
  if (cursor === 0) {
    enforceRateLimit(`signups:bulk:${admin.id}`, {
      limit: 6,
      windowMs: 10 * 60_000,
      message: 'Too many bulk imports. Wait a few minutes before running another.',
    })
  }

  // A stable order, so a cursor means the same row from one call to the next.
  let query = supabaseAdmin
    .from('player_signups')
    .select('id, profile_id, display_name, riot_tag, current_rank, peak_rank')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(MAX_BULK_ROWS)

  if (status !== 'all') query = query.eq('status', status)
  if (seasonId === '__none__') query = query.is('season_id', null)
  else if (seasonId) query = query.eq('season_id', seasonId)

  const { data, error: listError } = await query
  if (listError) {
    console.error('Failed to load signups for bulk import:', listError)
    throw error(500, 'Failed to load signups')
  }

  const total = data?.length ?? 0
  const signups = (data ?? []).slice(cursor)
  const [ratings, puuids] = await Promise.all([
    loadRatingsByName(signups.map((s) => s.display_name)),
    linkedPuuidsFor(signups.map((s) => s.profile_id)),
  ])
  const rows: BulkSignupRow[] = signups.map((s) => ({
    id: s.id,
    display_name: s.display_name,
    riot_tag: s.riot_tag,
    current_rank: s.current_rank,
    peak_rank: s.peak_rank,
    puuid: puuids.get(s.profile_id) ?? null,
    rating: ratings.get(ratingNameKey(s.display_name)) ?? null,
  }))
  if (rows.length === 0) {
    return json({
      success: true,
      total,
      nextCursor: null,
      report: {
        processed: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        stoppedEarly: false,
        remaining: 0,
        retryAfterMs: null,
        rows: [],
      },
    })
  }

  const report = await runBulkImport(
    rows,
    {
      async lookupRiot(target, opts) {
        const { rank } = await lookupSignupRank(target, opts)
        if (!rank) return null
        if (!rank.currentRank && !rank.peakRank) return null
        return { currentRank: rank.currentRank, peakRank: rank.peakRank }
      },

      async save(signupId: string, patch: SignupPatch) {
        const { error: updateError } = await supabaseAdmin
          .from('player_signups')
          .update(patch)
          .eq('id', signupId)
        if (updateError) throw new Error(updateError.message)
      },

      now: () => Date.now(),
    },
    { overwrite }
  )

  return json({
    success: true,
    total,
    nextCursor: report.stoppedEarly ? cursor + report.processed : null,
    report,
  })
}
