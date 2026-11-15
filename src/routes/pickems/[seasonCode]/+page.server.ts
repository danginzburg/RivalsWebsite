import { error } from '@sveltejs/kit'

import { requireAdmin, requireProfile } from '$lib/server/auth/profile'
import {
  getPickemContextBySeasonCode,
  getPickemResults,
  getPickemSubmissionForProfile,
  getPickemTeamsByIds,
  listPickemPublicSubmissions,
  type PickemContext,
} from '$lib/server/pickems'
import { getSeasonStandingsRanks } from '$lib/server/leaderboard/ranks'
import {
  bracketSeedsWithOpponents,
  combinePickemSeasonTotals,
  isPickemComplete,
  isPickemLocked,
  rankPickemLeaderboardEntries,
  type PickemFormat,
} from '$lib/pickems'
import type { PageServerLoad } from './$types'

type Profile = Awaited<ReturnType<typeof requireProfile>> | null

/** Everything one pick'em (the bracket or the weekly matchups) needs to render. */
async function loadDisplay(context: PickemContext, profile: Profile) {
  const { event, matches } = context
  if (!event) return null
  const preview = event.status === 'draft'

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

export const load: PageServerLoad = async ({ locals, params }) => {
  // A season can run a playoff bracket and weekly matchups side by side.
  const [bracketCtx, matchupsCtx] = await Promise.all([
    getPickemContextBySeasonCode(params.seasonCode, 'bracket'),
    getPickemContextBySeasonCode(params.seasonCode, 'matchups'),
  ])

  // A draft is hidden from the public; admins can open it as a read-only preview.
  const isAdmin = await requireAdmin(locals.user)
    .then(() => true)
    .catch(() => false)
  const visible = (ctx: PickemContext) =>
    ctx.event && (ctx.event.status !== 'draft' || isAdmin) ? ctx : null
  const contexts = { bracket: visible(bracketCtx), matchups: visible(matchupsCtx) }
  if (!contexts.bracket && !contexts.matchups) throw error(404, 'Pickem not available')

  const profile: Profile = locals.user ? await requireProfile(locals.user).catch(() => null) : null
  const [playoffs, weekly] = await Promise.all([
    contexts.bracket ? loadDisplay(contexts.bracket, profile) : null,
    contexts.matchups ? loadDisplay(contexts.matchups, profile) : null,
  ])

  // One season total across both pick'ems, counting only published ones.
  const published = [playoffs, weekly].filter((d) => d && !d.preview)
  const seasonBoard = combinePickemSeasonTotals(published.map((d) => d!.submissions))
  /*
   * The medal only means something once every result of every published
   * pick'em is in — before that the top is just whoever is ahead so far. A tie
   * at the top has no single champion, so nothing is awarded.
   */
  const seasonComplete =
    published.length > 0 && published.every((d) => d!.complete || d!.event.status === 'scored')
  const leaders = seasonBoard.filter((entry) => entry.rank === 1)
  const seasonChampionId =
    seasonComplete && leaders.length === 1 && leaders[0]!.score > 0 ? leaders[0]!.user.id : null

  // Open the one still taking picks, else the bracket.
  const defaultView: PickemFormat =
    weekly && (!playoffs || (weekly.viewer.canEdit && !playoffs.viewer.canEdit))
      ? 'matchups'
      : 'bracket'

  return {
    season: bracketCtx.season,
    playoffs,
    weekly,
    seasonBoard,
    seasonChampionId,
    me: profile ? { id: profile.id } : null,
    defaultView,
  }
}
