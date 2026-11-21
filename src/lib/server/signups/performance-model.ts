import { TEAM_BALANCE_RANKS } from '$lib/team-balance'
import { rankPoints, type Performance } from '$lib/signups/formula'

/**
 * League performance, measured against players who were the same rank.
 *
 * Teams mix ranks, so a stat line compared with the whole league mostly
 * measures rank: low ranks always score low and high ranks high. The score
 * already counts rank, so this model asks a narrower question instead — did the
 * player beat what players of their rank (and, where we know it, against that
 * strength of opponent) usually post?
 *
 * For each season:
 *   1. Each stat is regressed on rank points, plus the average rank of the
 *      opponents faced where per-map rows exist, weighted by rounds.
 *   2. A player's residual over the residual spread is their z-score for it.
 *   3. The z-scores combine by STAT_WEIGHTS and are re-standardised, so 1.0 is
 *      one standard deviation in that season.
 * Across seasons the lines combine weighted by rounds × season weight, then
 * shrink toward 0 by rounds / (rounds + SHRINK_ROUNDS), so a handful of maps
 * cannot swing a player far.
 *
 * Pure: the loader in `./performance` fetches the rows and caches the result.
 */

/**
 * The stats, and how much each counts. ADR is left out because it measures the
 * same damage ACS does.
 */
export const STAT_WEIGHTS = { acs: 0.35, kd: 0.2, kast: 0.25, fkfd: 0.2 } as const
type Stat = keyof typeof STAT_WEIGHTS
const STATS = Object.keys(STAT_WEIGHTS) as Stat[]

/** Weighted rounds at which a player's line is trusted halfway (~9 maps). */
export const SHRINK_ROUNDS = 200

/** Fewest players with an opponent average before a season's regressions use it. */
const MIN_OPPONENT_SAMPLE = 30

/** Fewest known opponent ranks on a map before it counts toward the average. */
const MIN_OPPONENTS_RANKED = 3

/** One player's season totals, as `aggregateFullSeasonRows` produces them. */
export type SeasonStatRow = {
  profile_id: string | null
  player_name: string | null
  rounds: number | null
  acs: number | null
  kills: number | null
  deaths: number | null
  kast_pct: number | null
  fk: number | null
  fd: number | null
  league_rank: string | null
}

/** One player on one map, for the opponent-strength average. */
export type MapStatRow = {
  match_map_id: string
  team_id: string
  profile_id: string | null
  player_name: string | null
  rounds: number | null
}

export type SeasonInput = {
  code: string
  /** How much this season counts against the others; the latest is 1. */
  weight: number
  rows: SeasonStatRow[]
  /** Per-map rows for this season, if any. Without them there is no opponent term. */
  mapRows?: MapStatRow[]
}

export type RankSource = 'season' | 'later season' | 'signup'

export type PlayerSeasonLine = {
  season: string
  seasonWeight: number
  key: string
  profileId: string | null
  name: string
  rounds: number
  rank: string | null
  rankSource: RankSource | null
  stats: Record<Stat, number | null>
  /** Rounds-weighted average rank points of the opponents faced. */
  opp: number | null
  z: Partial<Record<Stat, number>>
  /** Combined z-score for the season, in that season's standard deviations. */
  composite: number | null
}

export type PerformanceResult = Performance & {
  /** The rank-relative performance before the small-sample shrink. */
  combined: number
  /** rounds / (rounds + SHRINK_ROUNDS), on season-weighted rounds. */
  trust: number
  seasons: Array<{ code: string; rounds: number; perf: number }>
}

export type PerformanceModel = {
  lines: PlayerSeasonLine[]
  /** Season codes in order, oldest first. */
  seasons: string[]
}

const RANK_NAMES = new Set<string>(TEAM_BALANCE_RANKS.map((r) => r.name))

/** League-scale rank from a stats `league_rank`, which can read "Immortal 90RR". */
export function parseLeagueRank(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  if (RANK_NAMES.has(s)) return s
  const imm = /^immortal\s*(\d+)\s*rr$/i.exec(s)
  if (imm) {
    const rr = Number(imm[1])
    return rr >= 200 ? 'Immortal 3' : rr >= 100 ? 'Immortal 2' : 'Immortal 1'
  }
  if (/^immortal$/i.test(s)) return 'Immortal 1'
  return null
}

/** Name key used across stat sheets: the Riot name without its tag, lowercased. */
export function performanceNameKey(name: string | null | undefined): string {
  return String(name ?? '')
    .split('#')[0]
    .trim()
    .toLowerCase()
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Weighted least squares: coefficients b for y ≈ X·b. */
export function weightedLeastSquares(X: number[][], y: number[], w: number[]): number[] {
  const k = X[0]?.length ?? 0
  const A = Array.from({ length: k }, () => new Array<number>(k).fill(0))
  const b = new Array<number>(k).fill(0)
  for (let i = 0; i < y.length; i++) {
    for (let r = 0; r < k; r++) {
      b[r] += w[i] * X[i][r] * y[i]
      for (let c = 0; c < k; c++) A[r][c] += w[i] * X[i][r] * X[i][c]
    }
  }
  // Gauss–Jordan elimination with partial pivoting.
  for (let col = 0; col < k; col++) {
    let piv = col
    for (let r = col + 1; r < k; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
    ;[A[col], A[piv]] = [A[piv], A[col]]
    ;[b[col], b[piv]] = [b[piv], b[col]]
    if (A[col][col] === 0) continue
    for (let r = 0; r < k; r++) {
      if (r === col) continue
      const f = A[r][col] / A[col][col]
      for (let c = col; c < k; c++) A[r][c] -= f * A[col][c]
      b[r] -= f * b[col]
    }
  }
  return b.map((v, i) => (A[i][i] === 0 ? 0 : v / A[i][i]))
}

function weightedSd(values: number[], w: number[]): number {
  const W = w.reduce((a, b) => a + b, 0)
  if (W <= 0) return 1
  const mean = values.reduce((a, v, i) => a + v * w[i], 0) / W
  const variance = values.reduce((a, x, i) => a + w[i] * (x - mean) ** 2, 0) / W
  return Math.sqrt(variance) || 1
}

function toLine(season: SeasonInput, row: SeasonStatRow): PlayerSeasonLine | null {
  const rounds = num(row.rounds) ?? 0
  if (rounds <= 0) return null
  const kills = num(row.kills) ?? 0
  const deaths = num(row.deaths) ?? 0
  const rank = parseLeagueRank(row.league_rank)
  const key = row.profile_id || performanceNameKey(row.player_name)
  if (!key) return null
  return {
    season: season.code,
    seasonWeight: season.weight,
    key,
    profileId: row.profile_id,
    name: String(row.player_name ?? ''),
    rounds,
    rank,
    rankSource: rank ? 'season' : null,
    stats: {
      acs: num(row.acs),
      kd: deaths > 0 ? kills / deaths : null,
      kast: num(row.kast_pct),
      fkfd: ((num(row.fk) ?? 0) - (num(row.fd) ?? 0)) / rounds,
    },
    opp: null,
    z: {},
    composite: null,
  }
}

/** Index lines by profile id and by name key, the two ways stat rows identify players. */
function indexLines(lines: PlayerSeasonLine[]) {
  const byKey = new Map<string, PlayerSeasonLine>()
  const byName = new Map<string, PlayerSeasonLine>()
  for (const line of lines) {
    byKey.set(line.key, line)
    const name = performanceNameKey(line.name)
    if (name && !byName.has(name)) byName.set(name, line)
  }
  return (profileId: string | null, name: string | null) =>
    (profileId ? byKey.get(profileId) : undefined) ?? byName.get(performanceNameKey(name))
}

/**
 * Fill missing ranks: from the same player's nearest later season, else their
 * signup rank. Both are flagged by `rankSource`.
 */
function fillRanks(
  bySeason: PlayerSeasonLine[][],
  fallbackRankByProfile: Map<string, string | null>
) {
  const finders = bySeason.map((lines) =>
    indexLines(lines.filter((l) => l.rankSource === 'season'))
  )
  bySeason.forEach((lines, s) => {
    for (const line of lines) {
      if (line.rank) continue
      for (let later = s + 1; later < bySeason.length; later++) {
        const found = finders[later](line.profileId, line.name)
        if (found?.rank) {
          line.rank = found.rank
          line.rankSource = 'later season'
          break
        }
      }
      if (line.rank || !line.profileId) continue
      const signupRank = fallbackRankByProfile.get(line.profileId)
      if (signupRank && RANK_NAMES.has(signupRank)) {
        line.rank = signupRank
        line.rankSource = 'signup'
      }
    }
  })
}

/** Rounds-weighted average rank of the opponents each player faced this season. */
function fillOpponentStrength(lines: PlayerSeasonLine[], mapRows: MapStatRow[]) {
  if (mapRows.length === 0) return
  const find = indexLines(lines.filter((l) => l.rank))
  const pointsOf = (row: MapStatRow) => rankPoints(find(row.profile_id, row.player_name)?.rank)

  const byMap = new Map<string, MapStatRow[]>()
  for (const row of mapRows) {
    const list = byMap.get(row.match_map_id) ?? []
    list.push(row)
    byMap.set(row.match_map_id, list)
  }

  const acc = new Map<PlayerSeasonLine, { sum: number; w: number }>()
  const findAny = indexLines(lines)
  for (const rows of byMap.values()) {
    for (const row of rows) {
      const opponents = rows
        .filter((o) => o.team_id !== row.team_id)
        .map(pointsOf)
        .filter((v): v is number => v != null)
      if (opponents.length < MIN_OPPONENTS_RANKED) continue
      const line = findAny(row.profile_id, row.player_name)
      if (!line) continue
      const avg = opponents.reduce((a, b) => a + b, 0) / opponents.length
      const w = num(row.rounds) ?? 1
      const entry = acc.get(line) ?? { sum: 0, w: 0 }
      entry.sum += avg * w
      entry.w += w
      acc.set(line, entry)
    }
  }
  for (const [line, { sum, w }] of acc) line.opp = w > 0 ? sum / w : null
}

/** Rank-relative z-scores and the season composite, in place. */
function scoreSeason(lines: PlayerSeasonLine[]) {
  const pop = lines.filter((l) => rankPoints(l.rank) != null)
  if (pop.length === 0) return
  const withOpp = pop.filter((l) => l.opp != null)
  const useOpp = withOpp.length >= MIN_OPPONENT_SAMPLE
  const oppRounds = withOpp.reduce((a, l) => a + l.rounds, 0)
  const meanOpp = useOpp ? withOpp.reduce((a, l) => a + l.opp! * l.rounds, 0) / oppRounds : 0

  for (const stat of STATS) {
    const pts = pop.filter((l) => l.stats[stat] != null)
    if (pts.length < 3) continue
    const X = pts.map((l) => {
      const own = rankPoints(l.rank)!
      return useOpp ? [1, own, l.opp ?? meanOpp] : [1, own]
    })
    const y = pts.map((l) => l.stats[stat]!)
    const w = pts.map((l) => l.rounds)
    const b = weightedLeastSquares(X, y, w)
    const resid = pts.map((_, i) => y[i] - X[i].reduce((a, x, j) => a + x * b[j], 0))
    const sd = weightedSd(resid, w)
    pts.forEach((l, i) => (l.z[stat] = resid[i] / sd))
  }

  const composites = pop.map((l) => {
    let total = 0
    let wsum = 0
    for (const stat of STATS) {
      const z = l.z[stat]
      if (z == null) continue
      total += STAT_WEIGHTS[stat] * z
      wsum += STAT_WEIGHTS[stat]
    }
    return wsum > 0 ? total / wsum : null
  })
  const scored = pop
    .map((l, i) => [l, composites[i]] as const)
    .filter((pair): pair is readonly [PlayerSeasonLine, number] => pair[1] != null)
  const sd = weightedSd(
    scored.map(([, c]) => c),
    scored.map(([l]) => l.rounds)
  )
  for (const [line, c] of scored) line.composite = c / sd
}

/**
 * @param seasons oldest first
 * @param fallbackRankByProfile a rank to compare against for a season with no
 *   rank on record and no later season to borrow one from (the signup rank)
 */
export function buildPerformanceModel(
  seasons: SeasonInput[],
  fallbackRankByProfile: Map<string, string | null> = new Map()
): PerformanceModel {
  const bySeason = seasons.map((season) =>
    season.rows.map((row) => toLine(season, row)).filter((l): l is PlayerSeasonLine => l != null)
  )
  fillRanks(bySeason, fallbackRankByProfile)
  seasons.forEach((season, i) => fillOpponentStrength(bySeason[i], season.mapRows ?? []))
  bySeason.forEach(scoreSeason)
  return { lines: bySeason.flat(), seasons: seasons.map((s) => s.code) }
}

/**
 * A player's performance from their season lines. Lines are matched by profile
 * id, then by Riot name for lines that carry no profile id (a name already
 * claimed by another profile is not borrowed).
 */
export function performanceFor(
  model: PerformanceModel,
  player: { profileId: string; names: Array<string | null | undefined> }
): PerformanceResult | null {
  const keys = new Set(player.names.map(performanceNameKey).filter(Boolean))
  const bySeason = new Map<string, PlayerSeasonLine>()
  for (const line of model.lines) {
    if (line.profileId === player.profileId) bySeason.set(line.season, line)
  }
  for (const line of model.lines) {
    if (bySeason.has(line.season) || line.profileId) continue
    if (keys.has(performanceNameKey(line.name))) bySeason.set(line.season, line)
  }

  const lines = model.seasons
    .map((code) => bySeason.get(code))
    .filter((l): l is PlayerSeasonLine => l?.composite != null)
  if (lines.length === 0) return null

  const weighted = lines.reduce((a, l) => a + l.seasonWeight * l.rounds, 0)
  const combined =
    lines.reduce((a, l) => a + l.seasonWeight * l.rounds * l.composite!, 0) / weighted
  const trust = weighted / (weighted + SHRINK_ROUNDS)
  const latestRanked = [...lines].reverse().find((l) => l.rank)

  return {
    perf: combined * trust,
    rankThen: latestRanked?.rank ?? null,
    combined,
    trust,
    seasons: lines.map((l) => ({ code: l.season, rounds: l.rounds, perf: l.composite! })),
  }
}
