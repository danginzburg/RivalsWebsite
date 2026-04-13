import { error, json, type RequestHandler } from '@sveltejs/kit'

import {
  PICKEM_KIND,
  getPickemBaselineForSeason,
  getPickemSubmissionForProfile,
  isPickemLocked,
  validateBucketPayload,
  validatePickemBaseline,
} from '$lib/server/pickems'
import { requireProfile } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const profile = await requireProfile(locals.user)
  const seasonId = params.seasonId
  if (!seasonId) throw error(400, 'Season id is required')

  const baseline = await getPickemBaselineForSeason(seasonId)
  if (!baseline.config.enabled) throw error(403, 'Pickem is not enabled for this season')
  if (isPickemLocked(baseline.config)) throw error(403, 'Pickem submissions are locked')

  validatePickemBaseline(
    baseline.rows,
    baseline.config.participant_count,
    baseline.config.baseline_completed_rounds
  )

  const body = await request.json().catch(() => ({}))
  const validTeamIds = baseline.rows
    .map((row) => row.team?.id)
    .filter((teamId): teamId is string => Boolean(teamId))

  const payload = validateBucketPayload(body, validTeamIds, baseline.config.participant_count, {
    baselineRows: baseline.rows,
    baselineCompletedRounds: baseline.config.baseline_completed_rounds,
    predictionRound: baseline.config.prediction_round,
  })

  const existing = await getPickemSubmissionForProfile(seasonId, profile.id)
  if (existing) {
    throw error(409, 'You can only submit once for this pickem.')
  }

  const { data, error: insertError } = await supabaseAdmin
    .from('pickem_submissions')
    .insert({
      season_id: seasonId,
      profile_id: profile.id,
      kind: PICKEM_KIND,
      payload,
    })
    .select('id, updated_at')
    .single()

  if (insertError?.code === '23505') {
    throw error(409, 'You can only submit once for this pickem.')
  }
  if (insertError || !data) throw error(500, 'Failed to save pickem submission')

  return json({ success: true, submissionId: data.id, updatedAt: data.updated_at })
}
