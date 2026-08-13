import { describe, expect, it } from 'vitest'

import {
  aggregateRoster,
  aggregateSeasonStats,
  resolveSeasonStatBatchIds,
  type SeasonStatRow,
} from './season-batches'

const KICKOFF = '65ba73f4-1f38-47c3-82b9-2dbd775999a0'
const REGULAR = '9d7b560e-9af8-4744-b3e5-6b8894e34ce1'

describe('resolveSeasonStatBatchIds', () => {
  it('returns the curated list for a known season', () => {
    const ids = resolveSeasonStatBatchIds({ code: 'rivals4' })
    expect(ids).toHaveLength(4)
    expect(ids).toContain(KICKOFF)
    expect(ids).toContain(REGULAR)
  })

  it('never includes the same batch twice', () => {
    for (const code of ['rivals1', 'rivals2', 'rivals3', 'rivals4']) {
      const ids = resolveSeasonStatBatchIds({ code })
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('prefers a season metadata override so a new event needs no deploy', () => {
    const override = '11111111-1111-4111-8111-111111111111'
    expect(
      resolveSeasonStatBatchIds({ code: 'rivals4', metadata: { stat_batches: [override] } })
    ).toEqual([override])
  })

  it('ignores a malformed override rather than showing nothing', () => {
    expect(
      resolveSeasonStatBatchIds({ code: 'rivals4', metadata: { stat_batches: ['nope', 42] } })
    ).toHaveLength(4)
  })

  it('returns nothing for a season with no stats', () => {
    expect(resolveSeasonStatBatchIds({ code: 'rivals5' })).toEqual([])
    expect(resolveSeasonStatBatchIds(null)).toEqual([])
  })
})

describe('aggregateSeasonStats', () => {
  it('adds games and weights rate stats by rounds', () => {
    const stat = aggregateSeasonStats([
      { games: 6, rounds: 126, acs: 293.3, adr: 200, kills: 138, deaths: 77 },
      { games: 19, rounds: 387, acs: 252.5, adr: 150, kills: 345, deaths: 278 },
      { games: 10, rounds: 227, acs: 286.7, adr: 180, kills: 238, deaths: 149 },
    ])
    expect(stat?.games).toBe(35)
    // Weighted by rounds, not a flat mean of 277.5.
    expect(stat?.acs).toBeCloseTo(269.9, 1)
    expect(stat?.adr).toBeCloseTo(167.7, 1)
    // Recomputed from totals: 721 kills / 504 deaths.
    expect(stat?.kd).toBeCloseTo(1.43, 2)
  })

  it('falls back to games when an import carries no round counts', () => {
    const stat = aggregateSeasonStats([
      { games: 1, rounds: 0, acs: 100, adr: 50 },
      { games: 3, rounds: 0, acs: 200, adr: 150 },
    ])
    expect(stat?.acs).toBeCloseTo(175, 5)
    expect(stat?.adr).toBeCloseTo(125, 5)
  })

  it('uses the stored kd when no kills or deaths were imported', () => {
    const stat = aggregateSeasonStats([{ games: 4, rounds: 80, kd: 1.25 }])
    expect(stat?.kd).toBeCloseTo(1.25, 5)
  })

  it('reports no stats rather than zeroes when a player has no rows', () => {
    expect(aggregateSeasonStats([])).toBeNull()
  })
})

describe('aggregateRoster', () => {
  const rows: SeasonStatRow[] = [
    // Claimed only from the playoffs onward — the earlier events are name-only.
    { profile_id: 'p1', player_name: 'ZebraBrother', games: 10, rounds: 100, acs: 300 },
    { profile_id: null, player_name: 'zebrabrother', games: 6, rounds: 100, acs: 200 },
    { profile_id: 'p2', player_name: 'Someone Else', games: 5, rounds: 50, acs: 150 },
  ]

  it('folds name-only rows into a claimed player', () => {
    const [stat] = aggregateRoster([{ profile_id: 'p1', names: ['ZebraBrother'] }], rows)
    expect(stat?.games).toBe(16)
    expect(stat?.acs).toBeCloseTo(250, 5)
  })

  it('matches on any alias the player is known by', () => {
    const [stat] = aggregateRoster([{ profile_id: null, names: [null, 'zebrabrother'] }], rows)
    expect(stat?.games).toBe(16)
  })

  it('never counts a row claimed by a different profile', () => {
    const [stat] = aggregateRoster([{ profile_id: 'p3', names: ['Someone Else'] }], rows)
    expect(stat).toBeNull()
  })

  it('keeps results positionally aligned with the roster', () => {
    const stats = aggregateRoster(
      [
        { profile_id: null, names: ['nobody'] },
        { profile_id: 'p2', names: ['Someone Else'] },
      ],
      rows
    )
    expect(stats[0]).toBeNull()
    expect(stats[1]?.games).toBe(5)
  })
})
