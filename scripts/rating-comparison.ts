/**
 * Rating comparison: today's signup scores next to two rank-relative alternatives.
 *
 *   npx tsx --env-file=.env --tsconfig scripts/tsconfig.json scripts/rating-comparison.ts
 *
 * Read-only. Writes scripts/out/rating-comparison.csv (one row per signup for the
 * target season) and scripts/out/rating-comparison-summary.csv (average bonus by
 * tier), and prints the summary.
 *
 * Why: the imported sheet rating compares a player with the whole league. Teams
 * mix ranks, so low ranks score low and high ranks score high, and the rating
 * mostly re-measures rank, which the score already counts. A new player's
 * bonus of 0 then means "league average", which is too high for a low rank and
 * too low for a high one.
 *
 * The three systems in the sheet:
 *   Current  — the live formula: 0.35·C + 0.65·P + clamp(10·(rating − 1), ±5).
 *   Adjusted — the same sheet rating, measured against the rating expected for
 *              the rank the player held when they earned it.
 *   New      — our own metric from Season 3 + Season 4 stats: each stat is
 *              compared with players of the same rank at the time (and, in
 *              Season 4, the same opponent strength), Season 4 weighted above
 *              Season 3, shrunk toward 0 for small samples.
 * Adjusted and New bonuses both taper at the high end (TAPER below).
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { supabaseAdmin as db } from './lib/db'
import { TEAM_BALANCE_RANKS } from '$lib/team-balance'
import { computePlayerScore, rankPoints, ratingBonus, roundRating } from '$lib/signups/formula'
import { resolveSeasonStatBatchIds } from '$lib/server/stats/season-batches'
import { aggregateFullSeasonRows } from '$lib/server/stats/aggregate-full-season'
import { loadPlayerDirectory } from '$lib/server/players/directory'
import { loadRatingsForPlayers } from '$lib/server/signups/ratings'

// ── Tuning ───────────────────────────────────────────────────────────────────

/** The season whose signups are scored. */
const TARGET_SEASON = 'rivals5'

/** Stats seasons and how much each counts. Season 4 is more recent, so it counts double. */
const STAT_SEASONS = [
  { code: 'rivals3', label: 'S3', weight: 0.5 },
  { code: 'rivals4', label: 'S4', weight: 1.0 },
] as const

/** How the per-stat comparisons combine into one performance number. */
const STAT_WEIGHTS = { acs: 0.25, kd: 0.2, adr: 0.15, kast: 0.2, fkfd: 0.2 } as const

/** Weighted rounds at which a player's metric is trusted halfway (~9 maps). */
const SHRINK_ROUNDS = 200

/** New bonus: points per standard deviation of rank-relative performance, and its cap. */
const NEW_POINTS_PER_SD = 1.5
const NEW_CAP = 3

/** Adjusted bonus keeps the current scale: 10 points per 1.0 of rating, capped at ±5. */
const ADJUSTED_POINTS_PER_RATING = 10
const ADJUSTED_CAP = 5

/**
 * Bonuses shrink toward the top: full size at Iron, TAPER_FLOOR of full size at
 * Radiant, linear between, measured on the weighted rank score.
 */
const TAPER_FLOOR = 0.5
function taper(rankScore: number | null): number {
  if (rankScore == null) return 1
  const t = Math.min(1, Math.max(0, (rankScore - 1) / 24))
  return 1 - (1 - TAPER_FLOOR) * t
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const RANK_NAMES = new Set<string>(TEAM_BALANCE_RANKS.map((r) => r.name))

/** League-scale rank name from a stats `league_rank`, which may read "Immortal 90RR". */
function parseRank(raw: unknown): string | null {
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

const nameKey = (n: unknown) =>
  String(n ?? '')
    .split('#')[0]
    .trim()
    .toLowerCase()

const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function all<T = any>(
  table: string,
  cols: string,
  filter?: (q: any) => any,
  orderBy = 'id'
): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; ; i += 1000) {
    let q = db.from(table).select(cols).order(orderBy)
    if (filter) q = filter(q)
    const { data, error } = await q.range(i, i + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data as T[]))
    if (data.length < 1000) break
  }
  return out
}

/** Weighted least squares: coefficients for y ≈ X·b. */
function wls(X: number[][], y: number[], w: number[]): number[] {
  const k = X[0].length
  const A = Array.from({ length: k }, () => new Array(k).fill(0))
  const b = new Array(k).fill(0)
  for (let i = 0; i < y.length; i++) {
    for (let r = 0; r < k; r++) {
      b[r] += w[i] * X[i][r] * y[i]
      for (let c = 0; c < k; c++) A[r][c] += w[i] * X[i][r] * X[i][c]
    }
  }
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < k; col++) {
    let piv = col
    for (let r = col + 1; r < k; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
    ;[A[col], A[piv]] = [A[piv], A[col]]
    ;[b[col], b[piv]] = [b[piv], b[col]]
    for (let r = 0; r < k; r++) {
      if (r === col || A[col][col] === 0) continue
      const f = A[r][col] / A[col][col]
      for (let c = col; c < k; c++) A[r][c] -= f * A[col][c]
      b[r] -= f * b[col]
    }
  }
  return b.map((v, i) => (A[i][i] === 0 ? 0 : v / A[i][i]))
}

function weightedSd(values: number[], w: number[]): number {
  const W = w.reduce((a, b) => a + b, 0)
  const mean = values.reduce((a, v, i) => a + v * w[i], 0) / W
  const v = values.reduce((a, x, i) => a + w[i] * (x - mean) ** 2, 0) / W
  return Math.sqrt(v) || 1
}

const fmt = (v: number | null | undefined, d = 2) =>
  v == null || !Number.isFinite(v) ? '' : v.toFixed(d)

function csv(rows: Array<Record<string, unknown>>): string {
  const headers = Object.keys(rows[0] ?? {})
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers.join(','), ...rows.map((r) => headers.map((h) => cell(r[h])).join(','))].join(
    '\n'
  )
}

// ── Load ─────────────────────────────────────────────────────────────────────

const seasons = await all<{ id: string; code: string; metadata: any }>(
  'seasons',
  'id, code, metadata'
)
const seasonByCode = new Map(seasons.map((s) => [s.code, s]))
const target = seasonByCode.get(TARGET_SEASON)
if (!target) throw new Error(`No season ${TARGET_SEASON}`)

type PlayerSeason = {
  season: (typeof STAT_SEASONS)[number]['label']
  seasonWeight: number
  key: string
  profileId: string | null
  name: string
  rounds: number
  rank: string | null
  rankSource: 'season' | 'S4 rank' | 'signup rank' | null
  stats: {
    acs: number | null
    kd: number | null
    adr: number | null
    kast: number | null
    fkfd: number | null
  }
  opp: number | null
  z: Record<string, number | null>
  composite: number | null
}

const playerSeasons: PlayerSeason[] = []
const aggBySeason = new Map<string, Array<Record<string, any>>>()

for (const s of STAT_SEASONS) {
  const season = seasonByCode.get(s.code)
  const batchIds = resolveSeasonStatBatchIds(season ?? { code: s.code })
  const rows = await all('rivals_group_stats', '*', (q) => q.in('import_batch_id', batchIds))
  const agg = aggregateFullSeasonRows(rows, `season:${s.code}`)
  aggBySeason.set(s.label, agg)
  for (const r of agg) {
    const rounds = num(r.rounds) ?? 0
    if (rounds <= 0) continue
    const kills = num(r.kills) ?? 0
    const deaths = num(r.deaths) ?? 0
    playerSeasons.push({
      season: s.label,
      seasonWeight: s.weight,
      key: r.profile_id ?? nameKey(r.player_name),
      profileId: r.profile_id,
      name: String(r.player_name ?? ''),
      rounds,
      rank: parseRank(r.league_rank),
      rankSource: parseRank(r.league_rank) ? 'season' : null,
      stats: {
        acs: num(r.acs),
        kd: deaths > 0 ? kills / deaths : null,
        adr: num(r.adr),
        kast: num(r.kast_pct),
        fkfd: ((num(r.fk) ?? 0) - (num(r.fd) ?? 0)) / rounds,
      },
      opp: null,
      z: {},
      composite: null,
    })
  }
}

const signups = await all<{
  profile_id: string
  status: string
  discord_handle: string | null
  current_rank: string | null
  peak_rank: string | null
  computed_value: number | null
  manual_adjustment: number | null
  manual_value_override: number | null
}>(
  'player_signups',
  'id, profile_id, status, discord_handle, current_rank, peak_rank, computed_value, manual_adjustment, manual_value_override',
  (q) => q.eq('season_id', target.id)
)
const directory = await loadPlayerDirectory(signups.map((s) => s.profile_id))

// ── Rank at the time ─────────────────────────────────────────────────────────
// Season 3 stats carry no rank. Use the player's Season 4 rank, which is the
// nearest known, else their signup rank; both are flagged in the sheet.

const s4RankByKey = new Map<string, string>()
const s4RankByName = new Map<string, string>()
for (const p of playerSeasons) {
  if (p.season !== 'S4' || !p.rank) continue
  s4RankByKey.set(p.key, p.rank)
  s4RankByName.set(nameKey(p.name), p.rank)
}
const signupRankByProfile = new Map(signups.map((s) => [s.profile_id, s.current_rank]))
for (const p of playerSeasons) {
  if (p.rank) continue
  const s4 = s4RankByKey.get(p.key) ?? s4RankByName.get(nameKey(p.name))
  if (s4) {
    p.rank = s4
    p.rankSource = 'S4 rank'
    continue
  }
  const signup = p.profileId ? signupRankByProfile.get(p.profileId) : null
  if (signup && RANK_NAMES.has(signup)) {
    p.rank = signup
    p.rankSource = 'signup rank'
  }
}

// ── Opponent strength (Season 4 per-map rows) ────────────────────────────────

const s4Season = seasonByCode.get('rivals4')!
const s4Teams = new Set(
  (await all<{ id: string; season_id: string }>('teams', 'id, season_id'))
    .filter((t) => t.season_id === s4Season.id)
    .map((t) => t.id)
)
const mapRows = (
  await all<{
    match_map_id: string
    team_id: string
    profile_id: string | null
    player_name: string
    rounds: number
  }>('player_match_map_stats', 'id, match_map_id, team_id, profile_id, player_name, rounds')
).filter((r) => s4Teams.has(r.team_id))

const rankPtsOf = (profileId: string | null, name: string) => {
  const r = (profileId && s4RankByKey.get(profileId)) || s4RankByName.get(nameKey(name))
  return rankPoints(r ?? null)
}
const byMap = new Map<string, typeof mapRows>()
for (const r of mapRows)
  (byMap.get(r.match_map_id) ?? byMap.set(r.match_map_id, []).get(r.match_map_id)!).push(r)

const oppAcc = new Map<string, { sum: number; w: number }>()
for (const rows of byMap.values()) {
  for (const r of rows) {
    const opps = rows
      .filter((o) => o.team_id !== r.team_id)
      .map((o) => rankPtsOf(o.profile_id, o.player_name))
      .filter((v): v is number => v != null)
    if (opps.length < 3) continue
    const avg = opps.reduce((a, b) => a + b, 0) / opps.length
    const w = num(r.rounds) ?? 1
    for (const key of [r.profile_id, nameKey(r.player_name)].filter(Boolean) as string[]) {
      const acc = oppAcc.get(key) ?? { sum: 0, w: 0 }
      acc.sum += avg * w
      acc.w += w
      oppAcc.set(key, acc)
    }
  }
}
for (const p of playerSeasons) {
  if (p.season !== 'S4') continue
  const acc = oppAcc.get(p.key) ?? oppAcc.get(nameKey(p.name))
  p.opp = acc && acc.w > 0 ? acc.sum / acc.w : null
}

// ── Rank-relative z-scores per season ────────────────────────────────────────

const regressionNotes: string[] = []
for (const s of STAT_SEASONS) {
  const pop = playerSeasons.filter((p) => p.season === s.label && p.rank)
  const withOpp = pop.filter((p) => p.opp != null)
  const useOpp = withOpp.length >= 30
  const meanOpp = useOpp
    ? withOpp.reduce((a, p) => a + p.opp! * p.rounds, 0) / withOpp.reduce((a, p) => a + p.rounds, 0)
    : 0

  for (const stat of Object.keys(STAT_WEIGHTS) as Array<keyof typeof STAT_WEIGHTS>) {
    const pts = pop.filter((p) => p.stats[stat] != null)
    const X = pts.map((p) =>
      useOpp ? [1, rankPoints(p.rank)!, p.opp ?? meanOpp] : [1, rankPoints(p.rank)!]
    )
    const y = pts.map((p) => p.stats[stat]!)
    const w = pts.map((p) => p.rounds)
    const b = wls(X, y, w)
    const resid = pts.map((p, i) => y[i] - X[i].reduce((a, x, j) => a + x * b[j], 0))
    const sd = weightedSd(resid, w)
    pts.forEach((p, i) => (p.z[stat] = resid[i] / sd))
    regressionNotes.push(
      `${s.label} ${stat}: ${fmt(b[0])} + ${fmt(b[1], 3)}·rank${useOpp ? ` + ${fmt(b[2], 3)}·opp` : ''}  (sd ${fmt(sd, 3)}, n ${pts.length})`
    )
  }

  // Composite, re-standardized so 1.0 = one standard deviation in that season.
  const comp = pop.map((p) => {
    let total = 0
    let wsum = 0
    for (const [stat, wt] of Object.entries(STAT_WEIGHTS)) {
      const z = p.z[stat]
      if (z == null) continue
      total += wt * z
      wsum += wt
    }
    return wsum > 0 ? total / wsum : null
  })
  const valid = pop.map((p, i) => [p, comp[i]] as const).filter(([, c]) => c != null)
  const sd = weightedSd(
    valid.map(([, c]) => c!),
    valid.map(([p]) => p.rounds)
  )
  for (const [p, c] of valid) p.composite = c! / sd
}

// ── Adjusted sheet rating: expected rating for rank at the time ─────────────

const sheet = await all<{ name_key: string; rating: number }>(
  'player_ratings',
  'player_name, name_key, rating',
  undefined,
  'player_name'
)
const rankThenByName = new Map<string, string>()
for (const p of playerSeasons)
  if (p.rank && p.season === 'S4') rankThenByName.set(nameKey(p.name), p.rank)
for (const p of playerSeasons)
  if (p.rank && !rankThenByName.has(nameKey(p.name))) rankThenByName.set(nameKey(p.name), p.rank)
const sheetFit = sheet
  .map((r) => ({
    rating: Number(r.rating),
    pts: rankPoints(rankThenByName.get(r.name_key) ?? null),
  }))
  .filter((r) => r.pts != null)
const sheetB = wls(
  sheetFit.map((r) => [1, r.pts!]),
  sheetFit.map((r) => r.rating),
  sheetFit.map(() => 1)
)
const expectedRating = (pts: number) => sheetB[0] + sheetB[1] * pts

// ── Score every signup ───────────────────────────────────────────────────────

const ratings = await loadRatingsForPlayers(
  signups.map((s) => ({
    profile_id: s.profile_id,
    riot_name: directory.get(s.profile_id)?.riot_name ?? null,
  }))
)

const psByProfile = new Map<string, PlayerSeason[]>()
const psByName = new Map<string, PlayerSeason[]>()
for (const p of playerSeasons) {
  if (p.profileId)
    (psByProfile.get(p.profileId) ?? psByProfile.set(p.profileId, []).get(p.profileId)!).push(p)
  const k = nameKey(p.name)
  ;(psByName.get(k) ?? psByName.set(k, []).get(k)!).push(p)
}

const out: Array<Record<string, unknown>> = []
const tierAcc = new Map<
  string,
  { n: number; cur: number; adj: number; nw: number; returning: number }
>()

for (const s of signups) {
  const entry = directory.get(s.profile_id)
  const riotId = entry?.riot_name
    ? `${entry.riot_name}${entry.riot_tag ? `#${entry.riot_tag}` : ''}`
    : ''

  // This player's season lines: by profile, else by any of their Riot names.
  const found = new Map<string, PlayerSeason>()
  for (const p of psByProfile.get(s.profile_id) ?? []) found.set(p.season, p)
  for (const n of [entry?.riot_name, ...(entry?.riot_ids ?? [])]) {
    for (const p of psByName.get(nameKey(n)) ?? [])
      if (!found.has(p.season) && !p.profileId) found.set(p.season, p)
  }
  const s3 = found.get('S3')
  const s4 = found.get('S4')

  // Current system.
  const rating = ratings.get(s.profile_id)?.rating ?? null
  const base = computePlayerScore({ currentRank: s.current_rank, peakRank: s.peak_rank, rating })
  const rankScore = base.weightedRankScore
  const curBonus = ratingBonus(rating)
  const curScore = base.total
  const effective =
    s.manual_value_override != null
      ? Number(s.manual_value_override)
      : s.computed_value != null
        ? roundRating(Number(s.computed_value) + Number(s.manual_adjustment ?? 0))
        : null

  // Adjusted: sheet rating vs expected for the rank it was earned at.
  const rankThen = s4?.rank ?? s3?.rank ?? null
  const rankThenSource = s4?.rank
    ? `S4 (${s4.rankSource})`
    : s3?.rank
      ? `S3 (${s3.rankSource})`
      : ''
  const rankThenPts = rankPoints(rankThen) ?? rankPoints(s.current_rank)
  const exp = rating != null && rankThenPts != null ? expectedRating(rankThenPts) : null
  const adjBonus =
    rating != null && exp != null
      ? taper(rankScore) *
        Math.max(-ADJUSTED_CAP, Math.min(ADJUSTED_CAP, ADJUSTED_POINTS_PER_RATING * (rating - exp)))
      : 0
  const adjScore = rankScore == null ? null : rankScore + adjBonus

  // New metric: recency-weighted, shrunk for small samples.
  const lines = [s3, s4].filter((p): p is PlayerSeason => p?.composite != null)
  const neff = lines.reduce((a, p) => a + p.seasonWeight * p.rounds, 0)
  const combined =
    neff > 0 ? lines.reduce((a, p) => a + p.seasonWeight * p.rounds * p.composite!, 0) / neff : null
  const shrink = neff / (neff + SHRINK_ROUNDS)
  const metric = combined == null ? null : combined * shrink
  const newBonus =
    metric == null
      ? 0
      : taper(rankScore) * Math.max(-NEW_CAP, Math.min(NEW_CAP, NEW_POINTS_PER_SD * metric))
  const newScore = rankScore == null ? null : rankScore + newBonus

  const statZ = (stat: string) => {
    const zs = lines.filter((p) => p.z[stat] != null)
    const w = zs.reduce((a, p) => a + p.seasonWeight * p.rounds, 0)
    return w > 0 ? zs.reduce((a, p) => a + p.seasonWeight * p.rounds * p.z[stat]!, 0) / w : null
  }

  const flags: string[] = []
  if (!s3 && !s4) flags.push('no S3/S4 stats')
  if (s3?.rankSource && s3.rankSource !== 'season') flags.push(`S3 rank from ${s3.rankSource}`)
  if (neff > 0 && neff < SHRINK_ROUNDS) flags.push('small sample')
  if (rating == null && (s3 || s4)) flags.push('stats but no sheet rating')
  if (rankScore == null) flags.push('missing signup rank')
  if (s.manual_value_override != null) flags.push('manual override')

  out.push({
    Player: entry?.display_name ?? '',
    'Riot ID': riotId,
    Discord: s.discord_handle ?? entry?.discord_username ?? '',
    Status: s.status,
    Returning: s3 || s4 ? 'yes' : 'no',
    'Current rank': s.current_rank ?? '',
    'Peak rank': s.peak_rank ?? '',
    'Rank score (0.35C+0.65P)': fmt(rankScore),
    'Rank then': rankThen ?? '',
    'Rank then source': rankThenSource,
    'Rank change since':
      rankThen && s.current_rank
        ? fmt((rankPoints(s.current_rank) ?? 0) - (rankPoints(rankThen) ?? 0), 0)
        : '',
    // Current
    'CUR sheet rating': fmt(rating),
    'CUR bonus': fmt(curBonus),
    'CUR score': fmt(curScore),
    'CUR effective (with admin adj)': fmt(effective),
    // Adjusted
    'ADJ expected rating for rank then': fmt(exp),
    'ADJ rating vs expected': fmt(rating != null && exp != null ? rating - exp : null, 3),
    'ADJ bonus': fmt(adjBonus),
    'ADJ score': fmt(adjScore),
    'ADJ change vs CUR': fmt(adjScore != null && curScore != null ? adjScore - curScore : null),
    // New
    'NEW S3 rounds': s3?.rounds ?? '',
    'NEW S4 rounds': s4?.rounds ?? '',
    'NEW S3 perf (SD)': fmt(s3?.composite),
    'NEW S4 perf (SD)': fmt(s4?.composite),
    'NEW ACS vs rank (SD)': fmt(statZ('acs')),
    'NEW KD vs rank (SD)': fmt(statZ('kd')),
    'NEW ADR vs rank (SD)': fmt(statZ('adr')),
    'NEW KAST vs rank (SD)': fmt(statZ('kast')),
    'NEW FK-FD vs rank (SD)': fmt(statZ('fkfd')),
    'NEW combined (SD)': fmt(combined),
    'NEW sample trust': fmt(neff > 0 ? shrink : null),
    'NEW metric (SD)': fmt(metric),
    'NEW bonus': fmt(newBonus),
    'NEW score': fmt(newScore),
    'NEW change vs CUR': fmt(newScore != null && curScore != null ? newScore - curScore : null),
    'S4 avg opponent rank': fmt(s4?.opp, 1),
    Flags: flags.join('; '),
  })

  const tier = (s.current_rank ?? 'Unknown').replace(/\s*\d+$/, '')
  const t = tierAcc.get(tier) ?? { n: 0, cur: 0, adj: 0, nw: 0, returning: 0 }
  t.n++
  t.cur += curBonus
  t.adj += adjBonus
  t.nw += newBonus
  if (s3 || s4) t.returning++
  tierAcc.set(tier, t)
}

out.sort((a, b) => Number(b['CUR score'] || -99) - Number(a['CUR score'] || -99))

const tierOrder = [
  'Iron',
  'Bronze',
  'Silver',
  'Gold',
  'Platinum',
  'Diamond',
  'Ascendant',
  'Immortal',
  'Radiant',
  'Unknown',
]
const summary = [...tierAcc]
  .sort((a, b) => tierOrder.indexOf(a[0]) - tierOrder.indexOf(b[0]))
  .map(([tier, t]) => ({
    'Tier (current rank)': tier,
    Signups: t.n,
    Returning: t.returning,
    'Avg CUR bonus': fmt(t.cur / t.n),
    'Avg ADJ bonus': fmt(t.adj / t.n),
    'Avg NEW bonus': fmt(t.nw / t.n),
  }))

mkdirSync('scripts/out', { recursive: true })
writeFileSync('scripts/out/rating-comparison.csv', csv(out))
writeFileSync('scripts/out/rating-comparison-summary.csv', csv(summary))

console.log(`Signups scored: ${out.length} (${TARGET_SEASON})`)
console.log(
  `Player-seasons: ${playerSeasons.length}, with rank: ${playerSeasons.filter((p) => p.rank).length}`
)
console.log(
  `Sheet fit: expected rating = ${fmt(sheetB[0], 3)} + ${fmt(sheetB[1], 4)}·rank points (n ${sheetFit.length})`
)
console.log('Regressions:\n  ' + regressionNotes.join('\n  '))
console.table(summary)
