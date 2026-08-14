import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { enforceRateLimit } from '$lib/server/rate-limit'
import { RiotLookupError } from '$lib/server/riot/henrik'
import { fetchMatch, toImportMap, MATCH_REGIONS, type MatchRegion } from '$lib/server/riot/match'
import { parseMatchIdList } from '$lib/server/riot/match-id'
import { resolveSeriesTeams } from '$lib/server/riot/match-teams'
import { buildProfileMatcher, getProfilesForImports } from '$lib/server/imports/matching'
import { importCompletedSeries } from '$lib/server/matches/import-lifecycle'

/** A best-of-seven is the longest series the league runs. */
const MAX_MAPS = 7

function parseRegion(value: unknown): MatchRegion {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : 'na'
  if (!(MATCH_REGIONS as readonly string[]).includes(raw)) {
    throw error(400, `region must be one of ${MATCH_REGIONS.join(', ')}`)
  }
  return raw as MatchRegion
}

/**
 * Import a completed series straight from Riot match ids or tracker.gg links.
 *
 * The heavy lifting is deliberately not reimplemented here: once the matches
 * are fetched and shaped, `importCompletedSeries` does the team resolution,
 * profile matching, map insertion and stat rebuild exactly as the CSV import
 * does — so an API-imported match is indistinguishable from a hand-imported one.
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
  const { ids, unparsed } = parseMatchIdList(typeof body.input === 'string' ? body.input : '')

  if (ids.length === 0) {
    throw error(400, 'No Riot match ids or tracker.gg match links found in that input.')
  }
  if (ids.length > MAX_MAPS) {
    throw error(400, `That is ${ids.length} matches — a series is at most ${MAX_MAPS} maps.`)
  }

  // Each map is one upstream request, so the budget is per-map not per-call.
  enforceRateLimit(`matches:import-riot:${admin.id}`, {
    limit: 20,
    windowMs: 10 * 60_000,
    message: 'Too many match imports. Wait a few minutes before running more.',
  })

  let matches
  try {
    // Sequential rather than parallel: HenrikDev allows 30 requests a minute and
    // a burst of seven buys nothing when the admin is waiting on all of them.
    matches = []
    for (const id of ids) matches.push(await fetchMatch(id, region))
  } catch (err) {
    if (err instanceof RiotLookupError) throw error(err.status, err.message)
    throw err
  }

  const incomplete = matches.filter((m) => !m.isCompleted)
  if (incomplete.length > 0) {
    throw error(400, 'That match is still in progress, so its stats are not final yet.')
  }

  // Resolve the league teams from the first map's players, then hold that
  // mapping for the whole series — the sides swap between maps, so re-deriving
  // per map would flip team A and team B halfway through.
  const profiles = await getProfilesForImports()
  const profileMatcher = buildProfileMatcher(profiles)

  const { data: memberships } = await supabaseAdmin
    .from('team_memberships')
    .select('profile_id, team_id')
    .eq('is_active', true)

  const teamByProfileId = new Map<string, string>()
  for (const row of memberships ?? []) {
    if (row.profile_id) teamByProfileId.set(String(row.profile_id), String(row.team_id))
  }

  const resolveTeamId = (riotId: string) => {
    const profileId = profileMatcher.resolve(riotId)
    return profileId ? (teamByProfileId.get(profileId) ?? null) : null
  }

  const first = matches[0]
  const resolved = resolveSeriesTeams(
    first.players.map((p) => ({ riotId: p.riotId, team: p.team })),
    resolveTeamId
  )

  if (!resolved.ok) {
    throw error(
      422,
      `${resolved.failure.reason}${
        resolved.failure.unmatched.length > 0
          ? ` Unrecognised players: ${resolved.failure.unmatched.join(', ')}.`
          : ''
      }`
    )
  }

  const { teamAId, teamBId, teamAValorantSide, teamAVotes, teamBVotes, unmatched } =
    resolved.resolution

  const { data: teamRows } = await supabaseAdmin
    .from('teams')
    .select('id, name')
    .in('id', [teamAId, teamBId])

  const nameById = new Map((teamRows ?? []).map((t) => [t.id, String(t.name)]))
  const teamAName = nameById.get(teamAId)
  const teamBName = nameById.get(teamBId)
  if (!teamAName || !teamBName) throw error(422, 'Resolved a team that no longer exists.')

  /**
   * Sides swap at half time and between maps, so team A's colour on map 2 is
   * not necessarily its colour on map 1. Re-derive it per map from that map's
   * own players, falling back to the series mapping when a map's roster cannot
   * be read.
   */
  const maps = matches.map((match, index) => {
    const perMap = resolveSeriesTeams(
      match.players.map((p) => ({ riotId: p.riotId, team: p.team })),
      resolveTeamId
    )

    const sideForTeamA = perMap.ok
      ? perMap.resolution.teamAId === teamAId
        ? perMap.resolution.teamAValorantSide
        : (match.teams.find((t) => t.id !== perMap.resolution.teamAValorantSide)?.id ??
          teamAValorantSide)
      : teamAValorantSide

    return toImportMap(match, {
      teamAValorantSide: sideForTeamA,
      teamAName,
      teamBName,
      mapOrder: index + 1,
    })
  })

  const preview = {
    region,
    teamA: { id: teamAId, name: teamAName, rosterVotes: teamAVotes },
    teamB: { id: teamBId, name: teamBName, rosterVotes: teamBVotes },
    unmatchedPlayers: unmatched,
    unparsedInput: unparsed,
    maps: maps.map((map, index) => ({
      matchId: matches[index].matchId,
      mapName: map.mapName,
      startedAt: map.scheduledAt,
      score: `${map.teamARounds}-${map.teamBRounds}`,
      playerCount: map.playerRows.length,
    })),
  }

  if (dryRun) return json({ success: true, dryRun: true, preview })

  const result = await importCompletedSeries({
    payload: {
      displayName: `Riot import ${first.matchId}`,
      bestOf: body.bestOf,
      maps,
    },
    adminProfileId: admin.id,
  })

  return json({ success: true, dryRun: false, preview, result })
}
