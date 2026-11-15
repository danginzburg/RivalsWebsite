import {
  buildPickemSlots,
  getPickemResults,
  getPickemTeamsByIds,
  getPublishedPickemContextBySeasonId,
} from '$lib/server/pickems'
import type { PickemSlot, PickemTeam } from '$lib/pickems'
import { supabaseAdmin } from '$lib/supabase/admin'

/**
 * The played (or scheduled) result of a slot's real match, oriented to the
 * slot: `a` is the slot's teamA's map count, `b` its teamB's. Scores are null
 * until the match has a result.
 */
export type BracketSeries = {
  a: number | null
  b: number | null
  /** When the series is (or was) scheduled, falling back to when it ended; ISO. */
  at: string | null
  forfeit: boolean
}

export type SeasonBracket = {
  slots: PickemSlot[]
  teams: Record<string, PickemTeam>
  /** The real match behind each slot (linked or detected), keyed by slot id. */
  matchIds: Record<string, string>
  /** Score, date and forfeit per slot id, for slots with a real match. */
  series: Record<string, BracketSeries>
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

  const { linkedResults, sourceMatchIds } = await getPickemResults(ctx.event, ctx.matches)
  const slots = buildPickemSlots(ctx.event, ctx.matches, { picks: {} }, linkedResults)

  const teams: Record<string, PickemTeam> = {}
  for (const team of ctx.teams) teams[team.id] = team

  // A linked match can bring in a team the seeds never listed.
  const missing = slots
    .flatMap((slot) => [slot.teamAId, slot.teamBId, slot.winnerId])
    .filter((id): id is string => Boolean(id) && !teams[id!])
  for (const team of await getPickemTeamsByIds(missing)) teams[team.id] = team

  const series = await loadBracketSeries(slots, sourceMatchIds)

  return { slots, teams, matchIds: sourceMatchIds, series }
}

type SeriesRow = {
  id: string
  team_a_id: string | null
  team_b_id: string | null
  team_a_score: number | null
  team_b_score: number | null
  scheduled_at: string | null
  ended_at: string | null
  metadata: unknown
}

/**
 * Each slot's series score from its real match. The match's team A is not
 * necessarily the slot's team A, so scores are matched up by team id.
 */
export async function loadBracketSeries(
  slots: PickemSlot[],
  matchIds: Record<string, string>
): Promise<Record<string, BracketSeries>> {
  const ids = [...new Set(Object.values(matchIds))]
  if (ids.length === 0) return {}

  const { data, error } = await supabaseAdmin
    .from('matches')
    .select(
      'id, team_a_id, team_b_id, team_a_score, team_b_score, scheduled_at, ended_at, metadata'
    )
    .in('id', ids)
  // Scores are a nicety on top of the bracket; never fail the page over them.
  if (error || !data) return {}

  const byId = new Map((data as SeriesRow[]).map((row) => [row.id, row]))
  const out: Record<string, BracketSeries> = {}
  for (const slot of slots) {
    const row = byId.get(matchIds[slot.id] ?? '')
    if (!row) continue
    const scoreFor = (teamId: string | null) =>
      teamId == null
        ? null
        : teamId === row.team_a_id
          ? row.team_a_score
          : teamId === row.team_b_id
            ? row.team_b_score
            : null
    const meta =
      row.metadata && typeof row.metadata === 'object'
        ? (row.metadata as Record<string, unknown>)
        : {}
    out[slot.id] = {
      a: scoreFor(slot.teamAId),
      b: scoreFor(slot.teamBId),
      // The scheduled date, as the match page shows it; ended_at can be a later bookkeeping time.
      at: row.scheduled_at ?? row.ended_at,
      forfeit: Boolean(meta.forfeit),
    }
  }
  return out
}
