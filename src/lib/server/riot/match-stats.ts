/**
 * Derive per-player match stats from a HenrikDev v4 match payload.
 *
 * Pure on purpose: everything here is computed from the payload alone, so the
 * awkward parts (clutch detection, trade windows) can be tested against
 * hand-built rounds without touching the network.
 *
 * What the payload gives us directly is only kills, deaths, assists, score,
 * shot counts and damage. Everything a stats page actually wants — ACS, ADR,
 * KAST, first bloods, multikills, clutches — comes from replaying `kills[]`,
 * which is the full ordered kill timeline for the match.
 */

/** A kill event, narrowed to the fields used here. */
export type RiotKillEvent = {
  round: number
  time_in_round_in_ms: number
  killer: { puuid: string; team?: string | null } | null
  victim: { puuid: string; team?: string | null } | null
  assistants?: Array<{ puuid: string }> | null
}

export type RiotRound = {
  winning_team?: string | null
  plant?: { player?: { puuid: string } | null } | null
  defuse?: { player?: { puuid: string } | null } | null
  stats?: Array<{
    player?: { puuid: string } | null
    economy?: { loadout_value?: number | null; remaining?: number | null } | null
  }> | null
}

export type RiotPlayer = {
  puuid: string
  name: string
  tag: string
  team_id: string
  agent?: { name?: string | null } | null
  stats?: {
    score?: number | null
    kills?: number | null
    deaths?: number | null
    assists?: number | null
    headshots?: number | null
    bodyshots?: number | null
    legshots?: number | null
    damage?: { dealt?: number | null; received?: number | null } | null
  } | null
}

export type RiotMatch = {
  players: RiotPlayer[]
  rounds: RiotRound[]
  kills: RiotKillEvent[]
}

/**
 * How long after a death a teammate's revenge kill still counts as a trade.
 * Valorant analytics conventionally use three seconds; tracker.gg's KAST lines
 * up with that window.
 */
export const TRADE_WINDOW_MS = 3_000

export type MultiKills = {
  /** Rounds in which this player got exactly N kills. */
  k2: number
  k3: number
  k4: number
  k5: number
}

/** How many opponents were alive when the clutch began. */
export type ClutchSize = 1 | 2 | 3 | 4 | 5

export type ClutchRecord = {
  /** Clutches won, keyed by size: 1v1 … 1v5. */
  won: Record<ClutchSize, number>
  /**
   * Situations entered at each size, won or lost. Kept per size rather than as
   * one total so a 1v1 and a 1v5 are not read as the same achievement — the
   * attempt count is what makes a win rate meaningful.
   */
  attempted: Record<ClutchSize, number>
  totalWon: number
  totalAttempted: number
}

export type DerivedPlayerStats = {
  puuid: string
  name: string
  tag: string
  riotId: string
  team: string
  agent: string | null

  kills: number
  deaths: number
  assists: number

  /** Average combat score: total score over rounds played. */
  acs: number
  kd: number
  /** Average damage per round. */
  adr: number
  /** Percentage of rounds with a kill, assist, survival, or traded death. */
  kastPct: number
  hsPct: number
  firstKills: number
  firstDeaths: number
  plants: number
  defuses: number
  /**
   * Damage dealt per 1000 credits of loadout value — the usual reading of
   * "econ rating". Zero when no economy data is present.
   */
  econRating: number

  multiKills: MultiKills
  clutches: ClutchRecord
  /**
   * Kills this player got on each opponent, keyed by the opponent's puuid.
   *
   * Only one direction is stored: transposing the ten rows of a map gives the
   * deaths side of every duel, so keeping both would be duplicated state that
   * could disagree with itself.
   */
  duels: Record<string, number>
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function emptyClutches(): ClutchRecord {
  return { won: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, attempted: 0, totalWon: 0 }
}

/** Kill events for one round, oldest first. */
function killsByRound(match: RiotMatch): Map<number, RiotKillEvent[]> {
  const byRound = new Map<number, RiotKillEvent[]>()
  for (const kill of match.kills ?? []) {
    if (!kill.killer || !kill.victim) continue
    const list = byRound.get(kill.round)
    if (list) list.push(kill)
    else byRound.set(kill.round, [kill])
  }
  for (const list of byRound.values()) {
    list.sort((a, b) => a.time_in_round_in_ms - b.time_in_round_in_ms)
  }
  return byRound
}

/**
 * Which rounds each player earned KAST credit in.
 *
 * Survival counts, so a player who never fired but lived to the end of the
 * round still gets credit — that is what makes KAST a consistency measure
 * rather than a second kill stat.
 */
function computeKastRounds(
  match: RiotMatch,
  roundKills: Map<number, RiotKillEvent[]>,
  roundCount: number
): Map<string, number> {
  const credited = new Map<string, number>()
  const allPuuids = match.players.map((p) => p.puuid)

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex++) {
    const kills = roundKills.get(roundIndex) ?? []
    const roundCredit = new Set<string>()
    const died = new Set<string>()

    for (const kill of kills) {
      if (kill.killer) roundCredit.add(kill.killer.puuid)
      for (const assistant of kill.assistants ?? []) roundCredit.add(assistant.puuid)
      if (kill.victim) died.add(kill.victim.puuid)
    }

    // Survived the round.
    for (const puuid of allPuuids) {
      if (!died.has(puuid)) roundCredit.add(puuid)
    }

    // Traded: whoever killed you died soon afterwards, to someone else.
    for (const death of kills) {
      if (!death.victim) continue
      const killerPuuid = death.killer?.puuid
      if (!killerPuuid) continue

      const traded = kills.some(
        (revenge) =>
          revenge.victim?.puuid === killerPuuid &&
          revenge.time_in_round_in_ms > death.time_in_round_in_ms &&
          revenge.time_in_round_in_ms - death.time_in_round_in_ms <= TRADE_WINDOW_MS
      )
      if (traded) roundCredit.add(death.victim.puuid)
    }

    for (const puuid of roundCredit) {
      credited.set(puuid, (credited.get(puuid) ?? 0) + 1)
    }
  }

  return credited
}

/**
 * Clutch situations, replayed from the kill timeline.
 *
 * A clutch is entered the moment a team is cut down to its last player while
 * the other side still has someone alive. `rounds[].ceremony` flags that a
 * clutch happened but never how big it was, so the count of surviving
 * opponents has to be reconstructed here.
 */
function computeClutches(
  match: RiotMatch,
  roundKills: Map<number, RiotKillEvent[]>
): Map<string, ClutchRecord> {
  const records = new Map<string, ClutchRecord>()
  const teamOf = new Map(match.players.map((p) => [p.puuid, p.team_id]))
  const teams = Array.from(new Set(match.players.map((p) => p.team_id)))
  if (teams.length !== 2) return records

  match.rounds.forEach((round, roundIndex) => {
    const alive = new Map<string, Set<string>>(
      teams.map((team) => [
        team,
        new Set(match.players.filter((p) => p.team_id === team).map((p) => p.puuid)),
      ])
    )

    // Only the first clutch situation per team per round counts — once a side
    // is down to one player it stays that way until someone dies again.
    const claimed = new Set<string>()

    for (const kill of roundKills.get(roundIndex) ?? []) {
      const victimTeam = teamOf.get(kill.victim!.puuid)
      if (!victimTeam) continue
      alive.get(victimTeam)?.delete(kill.victim!.puuid)

      for (const team of teams) {
        const own = alive.get(team)!
        const opponents = alive.get(teams.find((t) => t !== team)!)!
        if (claimed.has(team) || own.size !== 1 || opponents.size === 0) continue

        claimed.add(team)
        const clutcher = [...own][0]
        const versus = Math.min(opponents.size, 5) as 1 | 2 | 3 | 4 | 5

        const record = records.get(clutcher) ?? emptyClutches()
        record.attempted += 1
        if (round.winning_team === team) {
          record.won[versus] += 1
          record.totalWon += 1
        }
        records.set(clutcher, record)
      }
    }
  })

  return records
}

/** Rounds in which each player got exactly 2/3/4/5 kills. */
function computeMultiKills(roundKills: Map<number, RiotKillEvent[]>): Map<string, MultiKills> {
  const result = new Map<string, MultiKills>()

  for (const kills of roundKills.values()) {
    const perKiller = new Map<string, number>()
    for (const kill of kills) {
      // Self-inflicted deaths are recorded with the victim as killer; they are
      // not kills and would otherwise inflate a round's tally.
      if (kill.killer!.puuid === kill.victim!.puuid) continue
      perKiller.set(kill.killer!.puuid, (perKiller.get(kill.killer!.puuid) ?? 0) + 1)
    }

    for (const [puuid, count] of perKiller) {
      if (count < 2) continue
      const entry = result.get(puuid) ?? { k2: 0, k3: 0, k4: 0, k5: 0 }
      if (count === 2) entry.k2 += 1
      else if (count === 3) entry.k3 += 1
      else if (count === 4) entry.k4 += 1
      else entry.k5 += 1
      result.set(puuid, entry)
    }
  }

  return result
}

/**
 * Kills between every pair of players — the data behind a head-to-head grid.
 *
 * Teammates are excluded: a kill on your own side is a mis-click or a spike
 * detonation, and showing it in a duel grid reads as though they fought.
 */
function computeDuels(
  match: RiotMatch,
  roundKills: Map<number, RiotKillEvent[]>
): Map<string, Record<string, number>> {
  const teamOf = new Map(match.players.map((p) => [p.puuid, p.team_id]))
  const duels = new Map<string, Record<string, number>>()

  for (const kills of roundKills.values()) {
    for (const kill of kills) {
      const killer = kill.killer!.puuid
      const victim = kill.victim!.puuid
      if (killer === victim) continue

      const killerTeam = teamOf.get(killer)
      const victimTeam = teamOf.get(victim)
      if (!killerTeam || !victimTeam || killerTeam === victimTeam) continue

      const row = duels.get(killer) ?? {}
      row[victim] = (row[victim] ?? 0) + 1
      duels.set(killer, row)
    }
  }

  return duels
}

/** First kill and first death counts, from the opening duel of each round. */
function computeOpeningDuels(roundKills: Map<number, RiotKillEvent[]>) {
  const firstKills = new Map<string, number>()
  const firstDeaths = new Map<string, number>()

  for (const kills of roundKills.values()) {
    const opener = kills[0]
    if (!opener) continue
    firstKills.set(opener.killer!.puuid, (firstKills.get(opener.killer!.puuid) ?? 0) + 1)
    firstDeaths.set(opener.victim!.puuid, (firstDeaths.get(opener.victim!.puuid) ?? 0) + 1)
  }

  return { firstKills, firstDeaths }
}

/** Total loadout value spent by each player across the match. */
function computeLoadoutValue(match: RiotMatch): Map<string, number> {
  const spend = new Map<string, number>()
  for (const round of match.rounds ?? []) {
    for (const entry of round.stats ?? []) {
      const puuid = entry.player?.puuid
      if (!puuid) continue
      const value = entry.economy?.loadout_value ?? 0
      spend.set(puuid, (spend.get(puuid) ?? 0) + value)
    }
  }
  return spend
}

/** Plant and defuse counts per player. */
function computeSpikeActions(match: RiotMatch) {
  const plants = new Map<string, number>()
  const defuses = new Map<string, number>()

  for (const round of match.rounds ?? []) {
    const planter = round.plant?.player?.puuid
    if (planter) plants.set(planter, (plants.get(planter) ?? 0) + 1)
    const defuser = round.defuse?.player?.puuid
    if (defuser) defuses.set(defuser, (defuses.get(defuser) ?? 0) + 1)
  }

  return { plants, defuses }
}

/** Every derived stat for every player in the match. */
export function derivePlayerStats(match: RiotMatch): DerivedPlayerStats[] {
  const roundCount = match.rounds?.length ?? 0
  const roundKills = killsByRound(match)

  const kastRounds = computeKastRounds(match, roundKills, roundCount)
  const clutches = computeClutches(match, roundKills)
  const multiKills = computeMultiKills(roundKills)
  const { firstKills, firstDeaths } = computeOpeningDuels(roundKills)
  const duels = computeDuels(match, roundKills)
  const { plants, defuses } = computeSpikeActions(match)
  const loadoutValue = computeLoadoutValue(match)

  return match.players.map((player) => {
    const stats = player.stats ?? {}
    const kills = stats.kills ?? 0
    const deaths = stats.deaths ?? 0
    const damage = stats.damage?.dealt ?? 0

    const headshots = stats.headshots ?? 0
    const bodyshots = stats.bodyshots ?? 0
    const legshots = stats.legshots ?? 0
    const shots = headshots + bodyshots + legshots

    const spend = loadoutValue.get(player.puuid) ?? 0

    return {
      puuid: player.puuid,
      name: player.name,
      tag: player.tag,
      riotId: `${player.name}#${player.tag}`,
      team: player.team_id,
      agent: player.agent?.name ?? null,

      kills,
      deaths,
      assists: stats.assists ?? 0,

      acs: roundCount > 0 ? round2((stats.score ?? 0) / roundCount) : 0,
      // Deaths of zero would divide by zero; a flawless game reads as K/D = K.
      kd: deaths > 0 ? round2(kills / deaths) : kills,
      adr: roundCount > 0 ? round2(damage / roundCount) : 0,
      kastPct:
        roundCount > 0 ? round2(((kastRounds.get(player.puuid) ?? 0) / roundCount) * 100) : 0,
      hsPct: shots > 0 ? round2((headshots / shots) * 100) : 0,
      firstKills: firstKills.get(player.puuid) ?? 0,
      firstDeaths: firstDeaths.get(player.puuid) ?? 0,
      plants: plants.get(player.puuid) ?? 0,
      defuses: defuses.get(player.puuid) ?? 0,
      econRating: spend > 0 ? round2((damage / spend) * 1000) : 0,

      multiKills: multiKills.get(player.puuid) ?? { k2: 0, k3: 0, k4: 0, k5: 0 },
      clutches: clutches.get(player.puuid) ?? emptyClutches(),
      duels: duels.get(player.puuid) ?? {},
    }
  })
}
