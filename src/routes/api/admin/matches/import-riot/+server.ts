import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { enforceRateLimit } from '$lib/server/rate-limit'
import { loadTargetMatch } from '$lib/server/matches/import-lifecycle'
import {
  commitRiotSeries,
  parseForfeitMap,
  parseRegion,
  parseSeriesInput,
  prepareRiotSeries,
} from '$lib/server/matches/riot-series'

/**
 * Import a completed series straight from Riot match ids or tracker.gg links.
 *
 * The fetching and team resolution live in `riot-series`, shared with the
 * captain result submission; the write goes through `importCompletedSeries`
 * exactly as the CSV import does — so an API-imported match is
 * indistinguishable from a hand-imported one.
 *
 * `dryRun` returns the resolved teams, scores and roster matching without
 * writing anything, because getting the wrong two teams is the failure worth
 * catching before it reaches the database.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const region = parseRegion(body.region)
  const dryRun = body.dryRun === true

  // An import aimed at an existing match (scheduled by hand, or live) takes its
  // teams, season and stage from that match — there is nothing to infer.
  const targetMatch = await loadTargetMatch(body.targetMatchId)
  const stage =
    typeof body.stage === 'string' && body.stage.trim() ? body.stage.trim() : targetMatch?.stage

  // importCompletedSeries enforces this too; checking up front saves the Riot
  // fetches on a save that would be rejected anyway. Previews don't need it.
  if (!dryRun && !stage) {
    throw error(400, 'Select a stage before importing.')
  }

  // An optional forfeited map has no Riot match id — one team conceded it, so it
  // is entered by hand and spliced into the fetched maps.
  const forfeitMap = parseForfeitMap(body.forfeitMap)
  const { ids, unparsed } = parseSeriesInput(body.input, forfeitMap)

  // Each map is one upstream request, so the budget is per-map not per-call.
  await enforceRateLimit(`matches:import-riot:${admin.id}`, {
    limit: 20,
    windowMs: 10 * 60_000,
    message: 'Too many match imports. Wait a few minutes before running more.',
  })

  // When the rosters can't identify the teams, the admin picks them by hand and
  // resends with these two ids. A target match supplies them itself.
  const prepared = await prepareRiotSeries({
    ids,
    unparsed,
    region,
    targetMatch,
    manualTeamAId: typeof body.teamAId === 'string' ? body.teamAId : '',
    manualTeamBId: typeof body.teamBId === 'string' ? body.teamBId : '',
    seasonId: body.seasonId,
    forfeitMap,
  })

  if (!prepared.ok) {
    // Tell the client the teams could not be identified so it can offer the
    // manual team picker rather than dead-ending.
    return json(
      {
        success: false,
        needsManualTeams: true,
        reason: prepared.reason,
        unmatchedPlayers: prepared.unmatchedPlayers,
      },
      { status: 422 }
    )
  }

  const { preview } = prepared.series
  if (dryRun) return json({ success: true, dryRun: true, preview })

  const result = await commitRiotSeries(prepared.series, {
    stage: stage as string,
    bestOf: body.bestOf,
    targetMatchId: targetMatch?.id ?? null,
    importerProfileId: admin.id,
  })

  return json({ success: true, dryRun: false, preview, result })
}
