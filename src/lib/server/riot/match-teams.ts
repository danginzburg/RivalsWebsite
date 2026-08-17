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
