import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { enforceRateLimit } from '$lib/server/rate-limit'
import { lookupPlayer, parseRiotId } from '$lib/server/riot/henrik'
import { lookupTrackerScore } from '$lib/server/tracker/client'
import {
  MAX_BULK_ROWS,
  runBulkImport,
  type BulkImportSource,
  type BulkSignupRow,
  type SignupPatch,
} from '$lib/server/signups/bulk-import'

const SOURCES: BulkImportSource[] = ['riot', 'tracker', 'both']

function parseSource(value: unknown): BulkImportSource {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!SOURCES.includes(raw as BulkImportSource)) {
    throw error(400, `source must be one of ${SOURCES.join(', ')}`)
  }
  return raw as BulkImportSource
}

/**
 * Fill ranks and tracker scores for many signups in one pass.
 *
 * Deliberately admin-only, rate limited, capped, and paced — it fans out to
 * two third-party services, one of which discourages automation.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const source = parseSource(body.source)
  const overwrite = body.overwrite === true
  const status = typeof body.status === 'string' && body.status ? body.status : 'pending'
  const seasonId = typeof body.seasonId === 'string' ? body.seasonId : null

  // A tracker run is far heavier than a Riot one, so it gets a tighter limit.
  enforceRateLimit(`signups:bulk:${source}:${admin.id}`, {
    limit: source === 'riot' ? 6 : 3,
    windowMs: 10 * 60_000,
    message: 'Too many bulk imports. Wait a few minutes before running another.',
  })

  let query = supabaseAdmin
    .from('player_signups')
    .select(
      'id, display_name, riot_tag, current_rank, peak_rank, tracker_current_score, tracker_peak_score'
    )
    .not('riot_tag', 'is', null)
    .order('created_at', { ascending: true })
    .limit(MAX_BULK_ROWS)

  if (status !== 'all') query = query.eq('status', status)
  if (seasonId === '__none__') query = query.is('season_id', null)
  else if (seasonId) query = query.eq('season_id', seasonId)

  const { data, error: listError } = await query
  if (listError) {
    console.error('Failed to load signups for bulk import:', listError)
    throw error(500, 'Failed to load signups')
  }

  const rows = (data ?? []) as BulkSignupRow[]
  if (rows.length === 0) {
    return json({
      success: true,
      report: {
        processed: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        stoppedEarly: false,
        remaining: 0,
        rows: [],
      },
    })
  }

  const report = await runBulkImport(
    rows,
    {
      async lookupRiot(riotId) {
        const { rank } = await lookupPlayer(riotId)
        if (!rank) return null
        return {
          currentRank: rank.currentRank,
          peakRank: rank.peakRank,
          peakSeasonId: rank.peakSeasonId,
        }
      },

      async lookupTracker(riotId, peakActId) {
        // Validate the shape here so a malformed tag fails as a tracker error
        // rather than throwing out of the pacing loop.
        parseRiotId(riotId)
        const result = await lookupTrackerScore(riotId, { peakActId })
        return {
          currentScore: result.current?.score ?? null,
          peakScore: result.peak?.score ?? null,
        }
      },

      async save(signupId: string, patch: SignupPatch) {
        const { error: updateError } = await supabaseAdmin
          .from('player_signups')
          .update(patch)
          .eq('id', signupId)
        if (updateError) throw new Error(updateError.message)
      },

      delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
    },
    { source, overwrite }
  )

  return json({ success: true, report })
}
