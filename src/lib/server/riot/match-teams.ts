/**
 * Work out which league teams played a Riot match, and which side each was on.
 *
 * Riot knows nothing about the league — a match only says "Red" and "Blue". The
 * bridge is the players: resolve each Riot ID to a profile, each profile to a
 * team, then let the majority on each side decide. Majority rather than
 * unanimity because a stand-in, an unclaimed profile or a smurf should not stop
 * an otherwise obvious match from importing.
 */

export type SidePlayer = {
  /** Riot ID as `name#tag`. */
  riotId: string
  /** 'Red' or 'Blue'. */
  team: string
  /** Riot PUUID, when known — the reliable key for a renamed player. */
  puuid?: string | null
}

export type TeamResolution = {
  /** Which Riot side maps to the series' team A. */
  teamAValorantSide: string
  teamAId: string
  teamBId: string
  /** How many players on each side backed the winning team id. */
  teamAVotes: number
  teamBVotes: number
  /** Riot IDs that resolved to no profile, or to a profile on neither team. */
  unmatched: string[]
}

export type TeamResolutionFailure = {
  reason: string
  /** Riot IDs that could not be tied to a team, to show the admin. */
  unmatched: string[]
  /** What each side voted for, so the admin can pick from real candidates. */
  candidates: Array<{ side: string; teamId: string; votes: number }>
}

/**
 * Players on a side who must agree before the team is taken as identified.
 *
 * One vote is not evidence. Half a lobby is routinely unregistered — stand-ins,
 * players who never signed up, players on last season's roster — so a single
 * recognised player is easy to come by and says very little. Observed on a real
 * import: one side had exactly one player from each of two unrelated teams, and
 * a plain "highest count wins" rule picked between them arbitrarily.
 */
export const MIN_ROSTER_VOTES = 2

/**
 * `resolveTeamId` returns the league team id for a Riot ID, or null when the
 * player is unknown. Passed in so this stays pure and testable.
 */
export function resolveSeriesTeams(
  players: SidePlayer[],
  resolveTeamId: (riotId: string, puuid?: string | null) => string | null
): { ok: true; resolution: TeamResolution } | { ok: false; failure: TeamResolutionFailure } {
  const sides = Array.from(new Set(players.map((p) => p.team)))
  if (sides.length !== 2) {
    return {
      ok: false,
      failure: {
        reason: `Expected two teams in the match, found ${sides.length}.`,
        unmatched: [],
        candidates: [],
      },
    }
  }

  const unmatched: string[] = []
  const votesBySide = new Map<string, Map<string, number>>(sides.map((side) => [side, new Map()]))

  for (const player of players) {
    const teamId = resolveTeamId(player.riotId, player.puuid)
    if (!teamId) {
      unmatched.push(player.riotId)
      continue
    }
    const tally = votesBySide.get(player.team)
    if (!tally) continue
    tally.set(teamId, (tally.get(teamId) ?? 0) + 1)
  }

  const candidates = sides.flatMap((side) =>
    [...(votesBySide.get(side) ?? new Map())]
      .map(([teamId, votes]) => ({ side, teamId, votes }))
      .sort((a, b) => b.votes - a.votes)
  )

  /**
   * The clear winner for a side, or why there isn't one. A tie is a refusal
   * rather than a coin flip — importing a series against the wrong team writes
   * results onto a roster that never played.
   */
  const winnerFor = (side: string): { teamId: string; votes: number } | string => {
    const ranked = candidates.filter((c) => c.side === side)
    if (ranked.length === 0) return `no player on ${side} is on a known roster`

    const [best, runnerUp] = ranked
    if (best.votes < MIN_ROSTER_VOTES) {
      return `only ${best.votes} recognised player on ${side}, which is not enough to identify a team`
    }
    if (runnerUp && runnerUp.votes === best.votes) {
      return `${side} is split evenly between two teams`
    }
    return best
  }

  const [sideA, sideB] = sides
  const winnerA = winnerFor(sideA)
  const winnerB = winnerFor(sideB)

  if (typeof winnerA === 'string' || typeof winnerB === 'string') {
    const problems = [winnerA, winnerB].filter((w): w is string => typeof w === 'string')
    return {
      ok: false,
      failure: {
        reason: `Could not identify both teams — ${problems.join('; ')}. Pick the teams by hand to import this series.`,
        unmatched,
        candidates,
      },
    }
  }

  // The same team on both sides means the roster lookup is wrong, not that a
  // team played itself — importing that would corrupt the match record.
  if (winnerA.teamId === winnerB.teamId) {
    return {
      ok: false,
      failure: {
        reason: 'Both sides resolved to the same team, so the rosters could not be told apart.',
        unmatched,
        candidates,
      },
    }
  }

  return {
    ok: true,
    resolution: {
      teamAValorantSide: sideA,
      teamAId: winnerA.teamId,
      teamBId: winnerB.teamId,
      teamAVotes: winnerA.votes,
      teamBVotes: winnerB.votes,
      unmatched,
    },
  }
}

/**
 * Which Valorant side team A is on for one map, by roster continuity.
 *
 * Red/Blue swap between maps, but the same ten players carry across the series,
 * so team A's side on any map is whichever side holds most of the players who
 * were on team A's side on the anchor map (map 1). This reads the players alone
 * — no league-roster lookup — so it stays correct even when the lobby is full of
 * unregistered players or stand-ins, which is exactly when per-map vote
 * resolution has nothing to decide on and would otherwise fall back to the Riot
 * player-array order and flip a map's result.
 *
 * Returns null when neither side holds a clear majority of the anchor roster (a
 * wholesale roster change between maps, or missing puuids), so the caller can
 * fall back to another signal.
 */
export function sideForTeamAByContinuity(
  anchorTeamAPuuids: Set<string>,
  mapPlayers: Array<{ team: string; puuid?: string | null }>
): string | null {
  if (anchorTeamAPuuids.size === 0) return null

  const overlap = new Map<string, number>()
  for (const p of mapPlayers) {
    if (p.puuid && anchorTeamAPuuids.has(p.puuid)) {
      overlap.set(p.team, (overlap.get(p.team) ?? 0) + 1)
    }
  }

  const ranked = [...overlap.entries()].sort((a, b) => b[1] - a[1])
  const [best, runnerUp] = ranked
  if (!best || best[1] === 0) return null
  // A tie means the anchor roster is split evenly across both sides, so it can't
  // say which side is team A's — leave it to the caller.
  if (runnerUp && runnerUp[1] === best[1]) return null
  return best[0]
}

/**
 * Resolve a series to two teams the admin picked by hand.
 *
 * Used when {@link resolveSeriesTeams} cannot identify the teams on its own —
 * too few recognised players, an even split, or nobody registered at all. The
 * teams are a given here; the one thing still to work out is which Valorant
 * side each is on, and that answer still comes from the players: whichever side
 * has more of team A's roster is taken as team A's side. With no recognised
 * players the sides are a guess (natural order), which the caller corrects by
 * re-running this per map — the same way the automatic path re-derives sides.
 */
export function resolveSeriesTeamsManual(
  players: SidePlayer[],
  resolveTeamId: (riotId: string, puuid?: string | null) => string | null,
  teamAId: string,
  teamBId: string
): { ok: true; resolution: TeamResolution } | { ok: false; failure: TeamResolutionFailure } {
  const sides = Array.from(new Set(players.map((p) => p.team)))
  if (sides.length !== 2) {
    return {
      ok: false,
      failure: {
        reason: `Expected two teams in the match, found ${sides.length}.`,
        unmatched: [],
        candidates: [],
      },
    }
  }

  const [sideA, sideB] = sides
  const tally = new Map<string, { a: number; b: number }>([
    [sideA, { a: 0, b: 0 }],
    [sideB, { a: 0, b: 0 }],
  ])
  // Players on neither chosen team, so they import by name only — the same
  // meaning `unmatched` carries out of the automatic path.
  const unmatched: string[] = []

  for (const player of players) {
    const side = tally.get(player.team)
    if (!side) continue
    const teamId = resolveTeamId(player.riotId, player.puuid)
    if (teamId === teamAId) side.a += 1
    else if (teamId === teamBId) side.b += 1
    else unmatched.push(player.riotId)
  }

  // Net lean toward team A on each side; the side leaning harder toward team A
  // is team A's. A tie (including no recognised players) keeps the natural
  // order, leaving sideA as team A.
  const leanA = tally.get(sideA)!.a - tally.get(sideA)!.b
  const leanB = tally.get(sideB)!.a - tally.get(sideB)!.b
  const teamAValorantSide = leanA >= leanB ? sideA : sideB
  const teamBValorantSide = teamAValorantSide === sideA ? sideB : sideA

  return {
    ok: true,
    resolution: {
      teamAValorantSide,
      teamAId,
      teamBId,
      teamAVotes: tally.get(teamAValorantSide)!.a,
      teamBVotes: tally.get(teamBValorantSide)!.b,
      unmatched,
    },
  }
}
