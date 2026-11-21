import { describe, expect, it } from 'vitest'

import {
  SHRINK_ROUNDS,
  buildPerformanceModel,
  parseLeagueRank,
  performanceFor,
  weightedLeastSquares,
  type SeasonStatRow,
} from './performance-model'

const RANKS = ['Gold 1', 'Platinum 1', 'Diamond 1', 'Ascendant 1', 'Immortal 1']

/**
 * A league where stats climb with rank, as they do in real seasons: every
 * player posts exactly what their rank predicts except `edge`, the amount added
 * to the base numbers.
 */
function player(
  name: string,
  rank: string | null,
  rankIndex: number,
  edge = 0,
  rounds = 400
): SeasonStatRow {
  const kills = Math.round(rounds * (0.6 + 0.05 * rankIndex + edge * 0.05))
  const deaths = Math.round(rounds * 0.7)
  return {
    profile_id: `p-${name}`,
    player_name: name,
    rounds,
    acs: 150 + 15 * rankIndex + edge * 20,
    kills,
    deaths,
    kast_pct: 68 + rankIndex + edge * 3,
    fk: Math.round(rounds * (0.1 + edge * 0.02)),
    fd: Math.round(rounds * 0.1),
    league_rank: rank,
  }
}

/** Two average players at every rank, plus noise players so spreads are nonzero. */
function league(extra: SeasonStatRow[] = []): SeasonStatRow[] {
  const rows: SeasonStatRow[] = []
  RANKS.forEach((rank, i) => {
    rows.push(player(`avg-a-${i}`, rank, i))
    rows.push(player(`avg-b-${i}`, rank, i))
    rows.push(player(`up-${i}`, rank, i, 0.5))
    rows.push(player(`down-${i}`, rank, i, -0.5))
  })
  return [...rows, ...extra]
}

describe('parseLeagueRank', () => {
  it('reads league ranks and Immortal RR', () => {
    expect(parseLeagueRank('Gold 2')).toBe('Gold 2')
    expect(parseLeagueRank('Immortal 0RR')).toBe('Immortal 1')
    expect(parseLeagueRank('Immortal 150RR')).toBe('Immortal 2')
    expect(parseLeagueRank('Immortal 200RR')).toBe('Immortal 3')
    expect(parseLeagueRank(null)).toBeNull()
    expect(parseLeagueRank('Unranked')).toBeNull()
  })
})

describe('weightedLeastSquares', () => {
  it('recovers a line', () => {
    const X = [1, 2, 3, 4].map((x) => [1, x])
    const y = [1, 2, 3, 4].map((x) => 3 + 2 * x)
    const [a, b] = weightedLeastSquares(X, y, [1, 1, 1, 1])
    expect(a).toBeCloseTo(3, 10)
    expect(b).toBeCloseTo(2, 10)
  })
})

describe('buildPerformanceModel', () => {
  it('rates a player against their own rank, not the league', () => {
    const model = buildPerformanceModel([{ code: 'rivals4', weight: 1, rows: league() }])

    // A Gold who posts Gold numbers is average, though below the league.
    const gold = performanceFor(model, { profileId: 'p-avg-a-0', names: [] })!
    const imm = performanceFor(model, { profileId: 'p-avg-a-4', names: [] })!
    expect(Math.abs(gold.perf)).toBeLessThan(0.05)
    expect(Math.abs(imm.perf)).toBeLessThan(0.05)
    expect(gold.rankThen).toBe('Gold 1')

    // Beating your rank is positive at any rank.
    expect(performanceFor(model, { profileId: 'p-up-0', names: [] })!.perf).toBeGreaterThan(0.5)
    expect(performanceFor(model, { profileId: 'p-down-4', names: [] })!.perf).toBeLessThan(-0.5)
  })

  it('shrinks a small sample toward zero', () => {
    const model = buildPerformanceModel([
      {
        code: 'rivals4',
        weight: 1,
        rows: league([
          player('short', 'Gold 1', 0, 0.5, 40),
          player('long', 'Gold 1', 0, 0.5, 800),
        ]),
      },
    ])
    const short = performanceFor(model, { profileId: 'p-short', names: [] })!
    const long = performanceFor(model, { profileId: 'p-long', names: [] })!
    expect(short.trust).toBeCloseTo(40 / (40 + SHRINK_ROUNDS), 10)
    expect(Math.abs(short.perf)).toBeLessThan(Math.abs(long.perf))
  })

  it('weights the later season more and borrows its rank for an unranked one', () => {
    const model = buildPerformanceModel([
      // Season 3 has no ranks on record; the player was above their rank there.
      {
        code: 'rivals3',
        weight: 0.5,
        rows: league([player('both', null, 1, 1)]).map((r) => ({ ...r, league_rank: null })),
      },
      { code: 'rivals4', weight: 1, rows: league([player('both', 'Platinum 1', 1, -1)]) },
    ])
    const both = performanceFor(model, { profileId: 'p-both', names: [] })!
    expect(both.seasons.map((s) => s.code)).toEqual(['rivals3', 'rivals4'])
    // Equal rounds, opposite form: Season 4's double weight wins.
    expect(both.combined).toBeLessThan(0)
    expect(both.rankThen).toBe('Platinum 1')
  })

  it('falls back to the signup rank when no season has one', () => {
    const rows = league().map((r) => ({ ...r, league_rank: null }))
    const fallback = new Map(rows.map((r, i) => [r.profile_id!, RANKS[Math.floor(i / 4)]]))
    const model = buildPerformanceModel([{ code: 'rivals3', weight: 1, rows }], fallback)
    const line = model.lines.find((l) => l.profileId === 'p-up-2')!
    expect(line.rankSource).toBe('signup')
    expect(line.rank).toBe('Diamond 1')
  })

  it('matches unclaimed stat lines by Riot name, ignoring the tag', () => {
    const unclaimed = { ...player('Old Name', 'Gold 1', 0, 0.5), profile_id: null }
    const model = buildPerformanceModel([{ code: 'rivals4', weight: 1, rows: league([unclaimed]) }])
    expect(performanceFor(model, { profileId: 'p-new', names: ['old name#NA1'] })).not.toBeNull()
    // A line that belongs to another profile is never borrowed by name.
    expect(performanceFor(model, { profileId: 'p-new', names: ['avg-a-0'] })).toBeNull()
  })

  it('returns null for a player with no stats', () => {
    const model = buildPerformanceModel([{ code: 'rivals4', weight: 1, rows: league() }])
    expect(performanceFor(model, { profileId: 'p-nobody', names: ['nobody'] })).toBeNull()
  })
})
