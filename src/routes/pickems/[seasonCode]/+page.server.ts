import { error } from '@sveltejs/kit'

import {
  buildEmptyBucketPayload,
  getCurrentBuckets,
  getPickemBaselineForSeason,
  getPickemSubmissionForProfile,
  isPickemLocked,
  listPickemRankedLeaderboardForSeason,
  listPickemSubmissionsForSeason,
  validatePickemBaseline,
} from '$lib/server/pickems'
import { supabaseAdmin } from '$lib/supabase/admin'

export const load = async ({ params, locals }) => {
  const seasonCode = String(params.seasonCode ?? '')
    .trim()
    .toUpperCase()

  if (!seasonCode) throw error(404, 'Pickem not found')

  const { data: season, error: seasonError } = await supabaseAdmin
    .from('seasons')
    .select('id')
    .ilike('code', seasonCode)
    .maybeSingle()

  if (seasonError || !season?.id) throw error(404, 'Pickem not found')

  const baseline = await getPickemBaselineForSeason(season.id)
  if (!baseline.config.enabled) throw error(404, 'Pickem not available')
  if (!baseline.config.leaderboard_batch_id) throw error(404, 'Pickem not configured')

  let baselineError: string | null = null
  try {
    validatePickemBaseline(
      baseline.rows,
      baseline.config.participant_count,
      baseline.config.baseline_completed_rounds
    )
  } catch (err) {
    baselineError = err instanceof Error ? err.message : 'Invalid pickem baseline'
  }

  let viewer: { profileId: string; displayName: string | null } | null = null
  if (locals.user?.sub) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name')
      .eq('auth0_sub', locals.user.sub)
      .maybeSingle()

    if (profile?.id) {
      viewer = { profileId: profile.id, displayName: profile.display_name ?? null }
    }
  }

  const [submission, submissionsList, pickemLeaderboard] = await Promise.all([
    viewer?.profileId
      ? getPickemSubmissionForProfile(season.id, viewer.profileId)
      : Promise.resolve(null),
    listPickemSubmissionsForSeason(season.id),
    listPickemRankedLeaderboardForSeason(season.id),
  ])

  const teamIds = baseline.rows.map((row) => row.team?.id).filter((id): id is string => Boolean(id))

  return {
    season: baseline.season,
    config: baseline.config,
    sourceBatch: baseline.sourceBatch,
    baselineRows: baseline.rows,
    baselineBuckets: getCurrentBuckets(baseline.rows, baseline.config.baseline_completed_rounds),
    baselineError,
    viewer,
    submission: submission?.payload ?? buildEmptyBucketPayload(teamIds),
    submissionMeta: submission
      ? {
          id: submission.id,
          updatedAt: submission.updated_at,
        }
      : null,
    isLocked: isPickemLocked(baseline.config),
    submissionsList,
    pickemLeaderboard,
    hasScoredLeaderboard: pickemLeaderboard.length > 0,
  }
}
