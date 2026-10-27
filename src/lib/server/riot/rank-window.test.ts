import { describe, expect, it } from 'vitest'

import { actLabel, isInRankWindow, summarizeRank, type MmrSeasonal } from './rank-window'

const tier = (id: number, name: string) => ({ id, name })
const UNRATED = tier(0, 'Unrated')

function act(short: string, endTier: { id: number; name: string }, wins = [endTier], games = 20) {
  return { season: { id: short, short }, games, end_tier: endTier, act_wins: wins } as MmrSeasonal
}

describe('isInRankWindow', () => {
  it('starts at V26 Act 1 (e11a1)', () => {
    expect(isInRankWindow('e10a6')).toBe(false)
    expect(isInRankWindow('e11a1')).toBe(true)
    expect(isInRankWindow('e11a6')).toBe(true)
    expect(isInRankWindow('e12a1')).toBe(true)
    expect(isInRankWindow('garbage')).toBe(false)
  })
})

describe('actLabel', () => {
  it('uses the year-based naming', () => {
    expect(actLabel('e11a4')).toBe('V26 A4')
    expect(actLabel('e10a2')).toBe('V25 A2')
  })
})

describe('summarizeRank', () => {
  it('uses the live rank and the best act win since V26 A1', () => {
    const result = summarizeRank({
      current: { tier: tier(18, 'Diamond 1'), rr: 40 },
      seasonal: [
        act('e10a6', tier(24, 'Immortal 1')), // before the window — ignored
        act('e11a1', tier(17, 'Platinum 3'), [tier(20, 'Diamond 3'), tier(17, 'Platinum 3')]),
        act('e11a4', tier(18, 'Diamond 1')),
      ],
    })

    expect(result.currentTier).toEqual(tier(18, 'Diamond 1'))
    expect(result.currentRr).toBe(40)
    expect(result.currentSource).toBe('current')
    expect(result.peakTier).toEqual(tier(20, 'Diamond 3'))
    expect(result.peakAct).toBe('V26 A1')
  })

  it('falls back to the last ranked act when the player is unrated now', () => {
    const result = summarizeRank({
      current: { tier: UNRATED, rr: 0 },
      seasonal: [
        act('e11a2', tier(14, 'Gold 3')),
        act('e11a3', tier(15, 'Platinum 1')),
        act('e11a5', UNRATED, [UNRATED], 3), // placements only
      ],
    })

    expect(result.currentTier).toEqual(tier(15, 'Platinum 1'))
    expect(result.currentSource).toBe('last-act')
    expect(result.currentAct).toBe('V26 A3')
    expect(result.peakTier).toEqual(tier(15, 'Platinum 1'))
  })

  it('ignores a stale live rank when nothing was played since V26 A1', () => {
    const result = summarizeRank({
      current: { tier: tier(21, 'Ascendant 1'), rr: 10 },
      seasonal: [act('e9a3', tier(21, 'Ascendant 1'))],
    })

    expect(result.currentTier).toBeNull()
    expect(result.currentSource).toBeNull()
    expect(result.peakTier).toBeNull()
  })

  it('lifts the peak to the live rank when it is higher than any act record', () => {
    const result = summarizeRank({
      current: { tier: tier(22, 'Ascendant 2'), rr: 5 },
      seasonal: [act('e11a6', tier(21, 'Ascendant 1'))],
    })

    expect(result.peakTier).toEqual(tier(22, 'Ascendant 2'))
    expect(result.peakAct).toBe('V26 A6')
  })

  it('skips acts with no games', () => {
    const result = summarizeRank({
      current: { tier: UNRATED },
      seasonal: [act('e11a2', tier(12, 'Gold 1')), act('e11a4', tier(19, 'Diamond 2'), [], 0)],
    })

    expect(result.currentTier).toEqual(tier(12, 'Gold 1'))
    expect(result.peakTier).toEqual(tier(12, 'Gold 1'))
  })
})
