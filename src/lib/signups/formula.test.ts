import { describe, expect, it } from 'vitest'

import { computePlayerScore, rankPoints, ratingBonus, roundRating } from './formula'

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

describe('ratingBonus', () => {
  it('is ten points per rating above 1, capped at 5', () => {
    expect(ratingBonus(1.1235187434481102)).toBeCloseTo(1.235187434481102, 10)
    expect(ratingBonus(1.8)).toBe(5)
  })

  it('is zero at or below average and without a rating', () => {
    expect(ratingBonus(0.93)).toBe(0)
    expect(ratingBonus(1)).toBe(0)
    expect(ratingBonus(null)).toBe(0)
    expect(ratingBonus(Number.NaN)).toBe(0)
  })
})

describe('computePlayerScore', () => {
  // Rows from the reference spreadsheet.
  it('matches a verified player with a bonus', () => {
    const result = computePlayerScore({
      currentRank: 'Immortal 1',
      peakRank: 'Immortal 2',
      rating: 1.1857185752751442,
    })
    expect(result.weightedRankScore).toBeCloseTo(22.65, 10)
    expect(result.total).toBeCloseTo(24.50718575275144, 10)
  })

  it('matches a verified player below average rating', () => {
    const result = computePlayerScore({
      currentRank: 'Gold 3',
      peakRank: 'Platinum 2',
      rating: 0.8702977792150813,
    })
    expect(result.bonus).toBe(0)
    expect(roundRating(result.total!)).toBe(13.3)
  })

  it('leaves the total blank when either rank is missing', () => {
    const noPeak = computePlayerScore({ currentRank: 'Ascendant 2', peakRank: null, rating: 1.2 })
    expect(noPeak.currentPoints).toBe(20)
    expect(noPeak.total).toBeNull()

    const noCurrent = computePlayerScore({ currentRank: null, peakRank: 'Diamond 3', rating: 1 })
    expect(noCurrent.total).toBeNull()
  })

  it('scores a player with no rating without a bonus', () => {
    const result = computePlayerScore({
      currentRank: 'Diamond 3',
      peakRank: 'Diamond 3',
      rating: null,
    })
    expect(result.total).toBe(18)
  })
})
