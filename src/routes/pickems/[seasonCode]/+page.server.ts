import { error } from '@sveltejs/kit'

import { requireProfile } from '$lib/server/auth/profile'
import {
  getActualPlayoffWinnersFromLinkedMatches,
  getPlayoffPickemContextBySeasonCode,
  getPlayoffPickemSubmissionForProfile,
  listPlayoffPickemLeaderboard,
  listPlayoffPickemPublicSubmissions,
} from '$lib/server/playoffPickems'
import { isPlayoffPickemLocked, type PlayoffMatchId } from '$lib/playoffPickems'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, params }) => {
  const context = await getPlayoffPickemContextBySeasonCode(params.seasonCode)
  if (!context.config.enabled || context.config.status === 'draft') {
    throw error(404, 'Pickem not available')
  }

  const profile = locals.user ? await requireProfile(locals.user).catch(() => null) : null
  const mySubmission = profile
    ? await getPlayoffPickemSubmissionForProfile(context.season.id, profile.id)
    : null
  const [submissions, leaderboard, actualWinners] = await Promise.all([
    listPlayoffPickemPublicSubmissions(context.season.id),
    listPlayoffPickemLeaderboard(context.season.id),
    getActualPlayoffWinnersFromLinkedMatches(context.config),
  ])
  const locked = isPlayoffPickemLocked(context.config)

  return {
    season: context.season,
    config: context.config,
    teams: context.teams,
    mySubmission,
    submissions,
    leaderboard,
    actualWinners: actualWinners as Partial<Record<PlayoffMatchId, string>>,
    viewer: {
      isLoggedIn: Boolean(profile),
      canEdit: Boolean(profile) && context.config.status === 'open' && !locked,
    },
    locked,
  }
}
