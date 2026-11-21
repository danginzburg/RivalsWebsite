import { buildPickemSlots, type PickemMatch, type PickemSlot } from '$lib/pickems'
import { getPickemResults, getPublishedPickemContextBySeasonId } from '$lib/server/pickems'
import { loadLegacyBracket } from '$lib/server/seasons/legacyBracket'
import { FIXED_PLAYOFF_PLACEMENTS } from '$lib/server/seasons/fixedPlacements'
import { bracketPlacement } from '$lib/server/leaderboard/playoff-placement'
import { getSeasonStandingsRanks } from '$lib/server/leaderboard/ranks'
import { finalPlacementsCache as cache } from '$lib/server/seasons/finalPlacementsCache'
import { supabaseAdmin } from '$lib/supabase/admin'

/**
 * Where every team finished a season, for career averages.
 *
 * Playoff teams take their place off the bracket (shared places such as
 * 5th–6th keep the range), with the admin-set winner, runner-up and 3rd laid
 * over it. Every team that missed the bracket ranks below it, in standings
 * order. A season that is not over yet — no winner recorded — has no finishes.
 *
 * A team with neither a bracket result nor a standings rank is left out and
 * named in `unplaced`, so callers can say the season's data is incomplete
 * instead of quietly averaging around it.
 */
export type FinalPlacement = {
  /** First place of the range ("5th" of 5th–6th). */
  start: number
  /** Last place of the range; equal to `start` for an outright finish. */
  end: number
}

export type SeasonFinalPlacements = {
  seasonId: string
  /** False until the season's winner is recorded. */
  finished: boolean
  /** How many approved, non-disbanded teams took part. */
  teamCount: number
  /** How many teams the bracket seeded; 0 when the season has none. */
  bracketSize: number
  placements: Record<string, FinalPlacement>
  /** Teams with no bracket result and no standings rank. */
  unplaced: string[]
}

type SeasonRow = {
  id: string
  code: string | null
  metadata: unknown
  winner_team_id: string | null
  runner_up_team_id: string | null
  third_place_team_id: string | null
  final_leaderboard_batch_id: string | null
}

export { invalidateFinalPlacements } from '$lib/server/seasons/finalPlacementsCache'

async function loadBracket(
  season: SeasonRow
): Promise<{ matches: PickemMatch[]; slots: PickemSlot[]; seeded: number } | null> {
  const ctx = await getPublishedPickemContextBySeasonId(season.id)
  if (ctx.event?.format === 'bracket' && ctx.matches.length > 0) {
    const { linkedResults } = await getPickemResults(ctx.event, ctx.matches)
    const slots = buildPickemSlots(ctx.event, ctx.matches, { picks: {} }, linkedResults)
    return { matches: ctx.matches, slots, seeded: ctx.event.seeds.length }
  }
  const legacy = await loadLegacyBracket(season.metadata)
  return legacy ? { matches: legacy.matches, slots: legacy.slots, seeded: legacy.teamCount } : null
}

async function loadBatchRanks(batchId: string): Promise<Record<string, number>> {
  const { data } = await supabaseAdmin
    .from('leaderboard_entries')
    .select('team_id, rank')
    .eq('import_batch_id', batchId)
  const ranks: Record<string, number> = {}
  for (const r of (data ?? []) as Array<{ team_id: string | null; rank: number | null }>) {
    if (r.team_id && Number(r.rank) > 0) ranks[r.team_id] = Number(r.rank)
  }
  return ranks
}

async function compute(seasonId: string): Promise<SeasonFinalPlacements> {
  const [{ data: season }, { data: teams }] = await Promise.all([
    supabaseAdmin
      .from('seasons')
      .select(
        'id, code, metadata, winner_team_id, runner_up_team_id, third_place_team_id, final_leaderboard_batch_id'
      )
      .eq('id', seasonId)
      .maybeSingle(),
    supabaseAdmin
      .from('teams')
      .select('id, status')
      .eq('season_id', seasonId)
      .eq('approval_status', 'approved'),
  ])
  const teamIds = ((teams ?? []) as Array<{ id: string; status: string | null }>)
    .filter((t) => t.status !== 'disbanded')
    .map((t) => t.id)
  const empty: SeasonFinalPlacements = {
    seasonId,
    finished: false,
    teamCount: teamIds.length,
    bracketSize: 0,
    placements: {},
    unplaced: [],
  }
  if (!season?.winner_team_id) return empty
  const row = season as SeasonRow

  const placements: Record<string, FinalPlacement> = {}
  const bracket = await loadBracket(row)
  const bracketTeams = new Set<string>()
  // A season whose bracket the site cannot draw has its places hard-coded.
  const fixed = bracket ? undefined : FIXED_PLAYOFF_PLACEMENTS[row.code ?? '']
  if (fixed) {
    for (const [teamId, place] of Object.entries(fixed.places)) {
      placements[teamId] = { ...place }
      bracketTeams.add(teamId)
    }
  }
  if (bracket) {
    for (const slot of bracket.slots) {
      if (slot.teamAId) bracketTeams.add(slot.teamAId)
      if (slot.teamBId) bracketTeams.add(slot.teamBId)
    }
    for (const teamId of bracketTeams) {
      const p = bracketPlacement(bracket.matches, bracket.slots, teamId)
      if (p?.decided) placements[teamId] = { start: p.worstStart, end: p.worstEnd }
    }
  }

  // The recorded results are the authority over whatever the bracket reads.
  const podium: Array<[string | null, number]> = [
    [row.winner_team_id, 1],
    [row.runner_up_team_id, 2],
    [row.third_place_team_id, 3],
  ]
  for (const [teamId, place] of podium) {
    if (!teamId) continue
    placements[teamId] = { start: place, end: place }
    bracketTeams.add(teamId)
  }

  // Everyone the bracket did not place ranks below it, in standings order —
  // the pinned final table when the season has one.
  const ranks = row.final_leaderboard_batch_id
    ? await loadBatchRanks(row.final_leaderboard_batch_id)
    : await getSeasonStandingsRanks(seasonId)
  const bracketSize = Math.max(bracket?.seeded ?? fixed?.size ?? 0, bracketTeams.size)
  const rest = teamIds
    .filter((id) => !bracketTeams.has(id) && ranks[id] !== undefined)
    .sort((a, b) => ranks[a] - ranks[b])
  rest.forEach((teamId, i) => {
    const place = bracketSize + i + 1
    placements[teamId] = { start: place, end: place }
  })

  return {
    seasonId,
    finished: true,
    teamCount: teamIds.length,
    bracketSize,
    placements,
    unplaced: teamIds.filter((id) => !placements[id]),
  }
}

export function loadSeasonFinalPlacements(seasonId: string): Promise<SeasonFinalPlacements> {
  return cache.wrap(seasonId, () => compute(seasonId))
}

/** The number a shared finish averages as: 5th–6th counts as 5.5. */
export function placementValue(p: FinalPlacement): number {
  return (p.start + p.end) / 2
}
