import { error } from '@sveltejs/kit'

import { requireAdmin, requireProfile } from '$lib/server/auth/profile'
import {
  getPickemContextBySeasonCode,
  getPickemResults,
  getPickemSubmissionForProfile,
  getPickemTeamsByIds,
  listPickemPublicSubmissions,
} from '$lib/server/pickems'
import { getSeasonStandingsRanks } from '$lib/server/leaderboard/ranks'
import {
  bracketSeedsWithOpponents,
  isPickemComplete,
  isPickemLocked,
  rankPickemLeaderboardEntries,
} from '$lib/pickems'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, params }) => {
  const context = await getPickemContextBySeasonCode(params.seasonCode)
  const { event, matches } = context
  if (!event) throw error(404, 'Pickem not available')
  // A draft is hidden from the public; admins can open it as a read-only preview.
  const preview = event.status === 'draft'
  if (preview) {
    await requireAdmin(locals.user).catch(() => {
      throw error(404, 'Pickem not available')
    })
  }

  const profile = locals.user ? await requireProfile(locals.user).catch(() => null) : null
  const mySubmission = profile ? await getPickemSubmissionForProfile(event.id, profile.id) : null
  // Results come from the real matches behind each slot — linked by an admin or
  // detected from the two teams that met. (The real bracket itself is drawn on
  // the leaderboard page.)
  const { actualWinners, linkedResults } = await getPickemResults(event, matches)
  const submissions = await listPickemPublicSubmissions(event.id, matches, actualWinners)
  const leaderboard = rankPickemLeaderboardEntries(submissions)
  const locked = isPickemLocked(event)
  const complete = isPickemComplete(matches, actualWinners)

  // Weekly matchups can be defined by linking a real match instead of assigning
  // teams, so fill each slot's teams from its linked game when not set directly.
  // (Brackets keep their seed/propagation teams.)
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

  // Picked opponents have no stored seed; rank them 5–8 by regular season.
  const seeds =
    event.format === 'bracket'
      ? bracketSeedsWithOpponents(
          event,
          matches,
          await getSeasonStandingsRanks(context.season.id).catch(() => ({}))
        )
      : (Object.fromEntries(event.seeds.map((s) => [s.teamId, s.seed])) as Record<string, number>)

  return {
    season: context.season,
    event,
    matches: resolvedMatches,
    teams: [...context.teams, ...extraTeams],
    seeds,
    resolvedSlotKeys: matches.filter((m) => m.actualWinnerId).map((m) => m.slotKey),
    mySubmission,
    submissions,
    leaderboard,
    actualWinners,
    complete,
    viewer: {
      isLoggedIn: Boolean(profile),
      canEdit: Boolean(profile) && event.status === 'open' && !locked,
    },
    locked,
    preview,
  }
}
