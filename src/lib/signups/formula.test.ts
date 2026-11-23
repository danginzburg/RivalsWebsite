import { describe, expect, it } from 'vitest'

import {
  bonusTaper,
  climbFactor,
  computePlayerScore,
  performanceBonus,
  rankPoints,
  roundRating,
} from './formula'

describe('rankPoints', () => {
  it('uses a linear scale from Iron 1 to Radiant', () => {
    expect(rankPoints('Iron 1')).toBe(1)
    expect(rankPoints('Silver 1')).toBe(7)
    expect(rankPoints('Ascendant 3')).toBe(21)
    expect(rankPoints('Immortal 1')).toBe(22)
    expect(rankPoints('Immortal 2')).toBe(23)
    expect(rankPoints('Radiant')).toBe(25)
  })

  it('returns null for missing or unknown ranks', () => {
    expect(rankPoints(null)).toBeNull()
    expect(rankPoints('Unrated')).toBeNull()
  })
})

describe('bonusTaper', () => {
  it('runs from full size at Iron to half at Radiant', () => {
    expect(bonusTaper(1)).toBe(1)
    expect(bonusTaper(13)).toBeCloseTo(0.75, 10)
    expect(bonusTaper(25)).toBe(0.5)
  })

  it('stays inside its range and is neutral without a rank score', () => {
    expect(bonusTaper(0)).toBe(1)
    expect(bonusTaper(30)).toBe(0.5)
    expect(bonusTaper(null)).toBe(1)
  })
})

describe('climbFactor', () => {
  it('loses a quarter per tier climbed since the stats were played', () => {
    expect(climbFactor('Gold 1', 'Gold 1')).toBe(1)
    expect(climbFactor('Platinum 1', 'Gold 1')).toBeCloseTo(0.75, 10)
    expect(climbFactor('Ascendant 1', 'Platinum 1')).toBeCloseTo(0.5, 10)
    expect(climbFactor('Radiant', 'Iron 1')).toBe(0)
  })

  it('does not grow for a player who dropped, or without both ranks', () => {
    expect(climbFactor('Gold 1', 'Diamond 1')).toBe(1)
    expect(climbFactor(null, 'Gold 1')).toBe(1)
    expect(climbFactor('Gold 1', null)).toBe(1)
  })
})

describe('performanceBonus', () => {
  const atIron = { currentRank: 'Iron 1', weightedRankScore: 1 }

  it('is two points per standard deviation, capped at ±3', () => {
    expect(performanceBonus({ perf: 0.5, rankThen: 'Iron 1' }, atIron)).toBe(1)
    expect(performanceBonus({ perf: 2, rankThen: 'Iron 1' }, atIron)).toBe(3)
    expect(performanceBonus({ perf: -0.25, rankThen: 'Iron 1' }, atIron)).toBe(-0.5)
    expect(performanceBonus({ perf: -5, rankThen: 'Iron 1' }, atIron)).toBe(-3)
  })

  it('applies the taper and the climb together', () => {
    // Radiant halves it; climbing one tier (Immortal 1 → Radiant) keeps three quarters.
    const bonus = performanceBonus(
      { perf: 1, rankThen: 'Immortal 1' },
      { currentRank: 'Radiant', weightedRankScore: 25 }
    )
    expect(bonus).toBeCloseTo(2 * 0.5 * 0.75, 10)
  })

  it('is zero without league stats', () => {
    expect(performanceBonus(null, atIron)).toBe(0)
    expect(performanceBonus({ perf: Number.NaN, rankThen: null }, atIron)).toBe(0)
    expect(Object.is(performanceBonus({ perf: 0, rankThen: null }, atIron), -0)).toBe(false)
  })
})

describe('computePlayerScore', () => {
  it('adds the bonus to the weighted rank score', () => {
    const result = computePlayerScore({
      currentRank: 'Immortal 1',
      peakRank: 'Immortal 2',
      performance: { perf: 0.4, rankThen: 'Immortal 1' },
    })
    expect(result.weightedRankScore).toBeCloseTo(22.65, 10)
    // 0.8 tapered by 1 − 0.5 × 21.65/24.
    expect(result.bonus).toBeCloseTo(0.8 * (1 - (0.5 * 21.65) / 24), 10)
    expect(roundRating(result.total!)).toBe(23.09)
  })

  it('penalises a player below their rank', () => {
    const result = computePlayerScore({
      currentRank: 'Gold 3',
      peakRank: 'Platinum 2',
      performance: { perf: -0.5, rankThen: 'Gold 3' },
    })
    expect(result.bonus).toBeLessThan(0)
    expect(roundRating(result.total!)).toBe(12.56)
  })

  it('leaves the total blank when either rank is missing', () => {
    const perf = { perf: 1, rankThen: 'Ascendant 2' }
    const noPeak = computePlayerScore({
      currentRank: 'Ascendant 2',
      peakRank: null,
      performance: perf,
    })
    expect(noPeak.currentPoints).toBe(20)
    expect(noPeak.total).toBeNull()

    const noCurrent = computePlayerScore({
      currentRank: null,
      peakRank: 'Diamond 3',
      performance: perf,
    })
    expect(noCurrent.total).toBeNull()
  })

  it('scores a player with no league stats without a bonus', () => {
    const result = computePlayerScore({
      currentRank: 'Diamond 3',
      peakRank: 'Diamond 3',
      performance: null,
    })
    expect(result.total).toBe(18)
  })
})
