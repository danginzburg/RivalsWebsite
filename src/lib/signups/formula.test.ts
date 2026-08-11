import { describe, expect, it } from 'vitest'

import { getRankValue } from '$lib/team-balance'

import { computeRating, computeRatingFromRankNames, roundRating } from './formula'

describe('computeRating', () => {
  it('applies each weighted term and the ratio multiplier', () => {
    const result = computeRating({
      currentRankValue: 30,
      peakRankValue: 40,
      trackerCurrentScore: 100,
      trackerPeakScore: Math.E ** 2, // ln = 2 exactly
    })

    expect(result.currentTerm).toBeCloseTo(0.575 * 30, 10)
    expect(result.peakTerm).toBeCloseTo(0.425 * 40, 10)
    expect(result.trackerCurrentTerm).toBeCloseTo(0.15 * 10, 10) // sqrt(100) = 10
    expect(result.trackerPeakTerm).toBeCloseTo(0.075 * 2, 10)

    const expectedBase = 0.575 * 30 + 0.425 * 40 + 0.15 * 10 + 0.075 * 2
    expect(result.base).toBeCloseTo(expectedBase, 10)

    // 1 + 0.1 * (30 / 40) = 1.075
    expect(result.multiplier).toBeCloseTo(1.075, 10)
    expect(result.rating).toBeCloseTo(expectedBase * 1.075, 10)
  })

  it('treats missing tracker scores as zero contribution', () => {
    const result = computeRating({
      currentRankValue: 35,
      peakRankValue: 35,
      trackerCurrentScore: null,
      trackerPeakScore: null,
    })

    expect(result.trackerCurrentTerm).toBe(0)
    expect(result.trackerPeakTerm).toBe(0)
    // Equal current and peak gives a flat 1.1 multiplier.
    expect(result.multiplier).toBeCloseTo(1.1, 10)
    expect(result.rating).toBeCloseTo((0.575 * 35 + 0.425 * 35) * 1.1, 10)
  })

  it('never divides by zero when peak rank is missing', () => {
    const result = computeRating({
      currentRankValue: 30,
      peakRankValue: 0,
      trackerCurrentScore: 0,
      trackerPeakScore: 0,
    })

    expect(result.multiplier).toBe(1)
    expect(Number.isFinite(result.rating)).toBe(true)
    expect(result.rating).toBeCloseTo(0.575 * 30, 10)
  })

  it('guards ln against zero and negative tracker peaks', () => {
    for (const trackerPeakScore of [0, 1, -50]) {
      const result = computeRating({
        currentRankValue: 30,
        peakRankValue: 30,
        trackerCurrentScore: 0,
        trackerPeakScore,
      })
      expect(result.trackerPeakTerm).toBe(0)
      expect(Number.isFinite(result.rating)).toBe(true)
    }
  })

  it('guards sqrt against negative tracker current scores', () => {
    const result = computeRating({
      currentRankValue: 30,
      peakRankValue: 30,
      trackerCurrentScore: -100,
      trackerPeakScore: 0,
    })

    expect(result.trackerCurrentTerm).toBe(0)
    expect(Number.isFinite(result.rating)).toBe(true)
  })

  it('coerces NaN inputs to zero rather than propagating', () => {
    const result = computeRating({
      currentRankValue: Number.NaN,
      peakRankValue: Number.NaN,
      trackerCurrentScore: Number.NaN,
      trackerPeakScore: Number.NaN,
    })

    expect(result.rating).toBe(0)
    expect(Number.isFinite(result.rating)).toBe(true)
  })

  it('rates a higher current rank above a lower one, all else equal', () => {
    const lower = computeRating({
      currentRankValue: 30,
      peakRankValue: 40,
      trackerCurrentScore: 100,
      trackerPeakScore: 500,
    })
    const higher = computeRating({
      currentRankValue: 38,
      peakRankValue: 40,
      trackerCurrentScore: 100,
      trackerPeakScore: 500,
    })

    expect(higher.rating).toBeGreaterThan(lower.rating)
  })
})

describe('computeRatingFromRankNames', () => {
  it('resolves rank names through the team balance table', () => {
    // Derived from the table rather than hardcoded, so a rescale of the rank
    // values does not silently invalidate this test.
    const gold1 = getRankValue('Gold 1')
    const diamond2 = getRankValue('Diamond 2')
    expect(gold1).toBeGreaterThan(0)
    expect(diamond2).toBeGreaterThan(gold1)

    const result = computeRatingFromRankNames({
      currentRank: 'Gold 1',
      peakRank: 'Diamond 2',
      trackerCurrentScore: null,
      trackerPeakScore: null,
    })

    expect(result.currentTerm).toBeCloseTo(0.575 * gold1, 10)
    expect(result.peakTerm).toBeCloseTo(0.425 * diamond2, 10)
  })

  it('treats unknown rank names as zero', () => {
    const result = computeRatingFromRankNames({
      currentRank: 'Not A Rank',
      peakRank: null,
      trackerCurrentScore: null,
      trackerPeakScore: null,
    })

    expect(result.rating).toBe(0)
  })
})

describe('roundRating', () => {
  it('rounds to two decimal places', () => {
    expect(roundRating(12.3456)).toBe(12.35)
    expect(roundRating(12.344)).toBe(12.34)
    expect(roundRating(10)).toBe(10)
  })
})
