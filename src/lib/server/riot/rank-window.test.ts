import { describe, expect, it } from 'vitest'

import {
  actLabel,
  isInRankWindow,
  peakRankBetween,
  rankAtTime,
  summarizeRank,
  type MmrSeasonal,
} from './rank-window'

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

describe('rankAtTime', () => {
  const game = (date: string, before: string, after: string) => ({
    date,
    tier_before_update: { id: 1, name: before },
    tier: { id: 1, name: after },
  })
  const gold2 = { id: 13, name: 'Gold 2' }
  const gold3 = { id: 14, name: 'Gold 3' }
  const plat1 = { id: 15, name: 'Platinum 1' }
  const history = [
    { date: '2026-07-01T00:00:00Z', tier_before_update: gold2, tier: gold3 },
    { date: '2026-07-20T00:00:00Z', tier_before_update: gold3, tier: plat1 },
  ]

  it('uses the rank after the last ranked game before the match', () => {
    expect(rankAtTime(history, new Date('2026-07-10T00:00:00Z'))?.name).toBe('Gold 3')
  })

  it('does not let later games rewrite an earlier match', () => {
    expect(rankAtTime(history, new Date('2026-07-25T00:00:00Z'))?.name).toBe('Platinum 1')
    expect(rankAtTime(history, new Date('2026-07-10T00:00:00Z'))?.name).not.toBe('Platinum 1')
  })

  it('falls back to the rank going into the first game soon after', () => {
    expect(rankAtTime(history, new Date('2026-06-20T00:00:00Z'))?.name).toBe('Gold 2')
  })

  it('says nothing when the nearest game is too far away', () => {
    expect(rankAtTime(history, new Date('2026-04-01T00:00:00Z'))).toBeNull()
  })

  it('skips unranked placeholder tiers', () => {
    expect(
      rankAtTime(
        [game('2026-07-01T00:00:00Z', 'Unrated', 'Unrated')],
        new Date('2026-07-02T00:00:00Z')
      )
    ).toBeNull()
  })
})

describe('peakRankBetween', () => {
  const t = (id: number, name: string) => ({ id, name })
  const history = [
    { date: '2026-08-20T00:00:00Z', tier_before_update: t(13, 'Gold 2'), tier: t(14, 'Gold 3') },
    {
      date: '2026-09-10T00:00:00Z',
      tier_before_update: t(14, 'Gold 3'),
      tier: t(15, 'Platinum 1'),
    },
    {
      date: '2026-09-20T00:00:00Z',
      tier_before_update: t(15, 'Platinum 1'),
      tier: t(14, 'Gold 3'),
    },
    { date: '2026-12-01T00:00:00Z', tier_before_update: t(14, 'Gold 3'), tier: t(18, 'Diamond 1') },
  ]
  const start = new Date('2026-09-01T00:00:00Z')
  const end = new Date('2026-11-08T00:00:00Z')

  it('takes the highest rank reached inside the window, even after a drop', () => {
    expect(peakRankBetween(history, start, end)?.name).toBe('Platinum 1')
  })

  it('ignores ranks reached after the tournament ended', () => {
    expect(peakRankBetween(history, start, end)?.name).not.toBe('Diamond 1')
  })

  it('keeps the rank carried in when no ranked games fall inside the window', () => {
    expect(
      peakRankBetween(history, new Date('2026-08-25T00:00:00Z'), new Date('2026-09-05T00:00:00Z'))
        ?.name
    ).toBe('Gold 3')
  })
})
