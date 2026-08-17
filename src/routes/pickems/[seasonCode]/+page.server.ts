import { error } from '@sveltejs/kit'

import { requireProfile } from '$lib/server/auth/profile'
import {
  getActualWinnersFromLinkedMatches,
  getLinkedResults,
  getPickemContextBySeasonCode,
  getPickemSubmissionForProfile,
  getPickemTeamsByIds,
  listPickemLeaderboard,
  listPickemPublicSubmissions,
} from '$lib/server/pickems'
import { isPickemLocked } from '$lib/pickems'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, params }) => {
  const context = await getPickemContextBySeasonCode(params.seasonCode)
  const { event, matches } = context
  if (!event || event.status === 'draft') {
    throw error(404, 'Pickem not available')
  }

  const profile = locals.user ? await requireProfile(locals.user).catch(() => null) : null
  const mySubmission = profile ? await getPickemSubmissionForProfile(event.id, profile.id) : null
  const [submissions, leaderboard, actualWinners, linkedResults] = await Promise.all([
    listPickemPublicSubmissions(event.id),
    listPickemLeaderboard(event.id),
    getActualWinnersFromLinkedMatches(matches),
    // For the "Actual Bracket" view: a reconstructed bracket's real matches can
    // route teams differently than the seed layout, so the true teams/winners
    // come from the linked games rather than seed propagation.
    getLinkedResults(matches),
  ])
  const locked = isPickemLocked(event)

  // Weekly matchups can be defined by linking a real match instead of assigning
  // teams, so fill each slot's teams from its linked game when not set directly.
  // (Brackets keep their seed/propagation teams; the linked results only feed
  // the Actual Bracket view.)
  const resolvedMatches =
    event.format === 'matchups'
      ? matches.map((m) => {
          const link = linkedResults[m.slotKey]
          if (!link) return m
          return {
            ...m,
            teamAId: m.teamAId ?? link.teamAId ?? null,
            teamBId: m.teamBId ?? link.teamBId ?? null,
          }
        })
      : matches

  // Backfill any team a linked match or actual result references that the
  // seeds/assigned slots did not, so nothing renders as "Unknown team".
  const knownTeamIds = new Set(context.teams.map((t) => t.id))
  const referencedTeamIds = new Set<string>()
  for (const m of resolvedMatches) {
    for (const id of [m.teamAId, m.teamBId])
      if (id && !knownTeamIds.has(id)) referencedTeamIds.add(id)
  }
  for (const link of Object.values(linkedResults)) {
    for (const id of [link.teamAId, link.teamBId, link.winnerId])
      if (id && !knownTeamIds.has(id)) referencedTeamIds.add(id)
  }
  for (const id of Object.values(actualWinners))
    if (!knownTeamIds.has(id)) referencedTeamIds.add(id)
  const extraTeams =
    referencedTeamIds.size > 0 ? await getPickemTeamsByIds([...referencedTeamIds]) : []

  return {
    season: context.season,
    event,
    matches: resolvedMatches,
    teams: [...context.teams, ...extraTeams],
    seeds: Object.fromEntries(event.seeds.map((s) => [s.teamId, s.seed])) as Record<string, number>,
    resolvedSlotKeys: matches.filter((m) => m.actualWinnerId).map((m) => m.slotKey),
    mySubmission,
    submissions,
    leaderboard,
    actualWinners,
    linkedResults,
    viewer: {
      isLoggedIn: Boolean(profile),
      canEdit: Boolean(profile) && event.status === 'open' && !locked,
    },
    locked,
  }
}
