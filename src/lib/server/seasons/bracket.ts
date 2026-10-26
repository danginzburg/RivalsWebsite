import {
  buildPickemSlots,
  getPickemResults,
  getPickemTeamsByIds,
  getPublishedPickemContextBySeasonId,
} from '$lib/server/pickems'
import type { PickemSlot, PickemTeam } from '$lib/pickems'

export type SeasonBracket = {
  slots: PickemSlot[]
  teams: Record<string, PickemTeam>
}

/**
 * A season's playoff bracket as `ArchiveBracket` draws it, from the season's
 * pick'em event. Null when the season has no bracket configured.
 *
 * Winners come from the real matches behind the slots (linked or detected),
 * with any admin-resolved winner layered on top — the same rule the event page
 * uses.
 */
export async function loadSeasonBracket(seasonId: string): Promise<SeasonBracket | null> {
  const ctx = await getPublishedPickemContextBySeasonId(seasonId)
  if (ctx.event?.format !== 'bracket' || ctx.matches.length === 0) return null

  const { linkedResults } = await getPickemResults(ctx.event, ctx.matches)
  const slots = buildPickemSlots(ctx.event, ctx.matches, { picks: {} }, linkedResults)

  const teams: Record<string, PickemTeam> = {}
  for (const team of ctx.teams) teams[team.id] = team

  // A linked match can bring in a team the seeds never listed.
  const missing = slots
    .flatMap((slot) => [slot.teamAId, slot.teamBId, slot.winnerId])
    .filter((id): id is string => Boolean(id) && !teams[id!])
  for (const team of await getPickemTeamsByIds(missing)) teams[team.id] = team

  return { slots, teams }
}
