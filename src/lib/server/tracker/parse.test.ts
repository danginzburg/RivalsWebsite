import { describe, expect, it } from 'vitest'

import {
  findActById,
  parseActScore,
  parseHandle,
  parseSeasons,
  pickPeak,
  recomputeScore,
} from './parse'

/** Shape captured from a real tracker.gg response. */
const segmentFixture = {
  data: [
    {
      stats: {
        trnPerformanceScore: {
          value: 830,
          displayValue: '830',
          metadata: {
            stats: ['roundsWinPct', 'kAST', 'scorePerRound', 'damageDeltaPerRound'],
          },
        },
        roundsWinPct: { value: 55.17241, percentile: 96.3 },
        kAST: { value: 74.14, percentile: 84 },
        scorePerRound: { value: 228.7586, percentile: 70 },
        damageDeltaPerRound: { value: 27.31034, percentile: 89 },
      },
    },
  ],
}

const act = { id: 'act-1', shortName: 'E26: A4' }

describe('parseSeasons', () => {
  it('extracts acts from a profile payload', () => {
    const seasons = parseSeasons({
      data: {
        metadata: { seasons: [{ id: 'a', shortName: 'E26: A4', name: 'Episode 26 Act 4' }] },
      },
    })
    expect(seasons).toEqual([{ id: 'a', shortName: 'E26: A4', name: 'Episode 26 Act 4' }])
  })

  it('drops entries without an id', () => {
    const seasons = parseSeasons({ data: { metadata: { seasons: [{ shortName: 'x' }] } } })
    expect(seasons).toEqual([])
  })

  it('returns empty for malformed payloads', () => {
    expect(parseSeasons(null)).toEqual([])
    expect(parseSeasons({})).toEqual([])
    expect(parseSeasons({ data: { metadata: { seasons: 'nope' } } })).toEqual([])
  })
})

describe('parseHandle', () => {
  it('reads the platform handle', () => {
    expect(parseHandle({ data: { platformInfo: { platformUserHandle: 'Ticua#PRIME' } } })).toBe(
      'Ticua#PRIME'
    )
  })

  it('returns null when absent', () => {
    expect(parseHandle({})).toBeNull()
    expect(parseHandle(null)).toBeNull()
  })
})

describe('parseActScore', () => {
  it('reads the reported score and its components', () => {
    const parsed = parseActScore(segmentFixture, act)
    expect(parsed).not.toBeNull()
    expect(parsed!.score).toBe(830)
    expect(parsed!.actShortName).toBe('E26: A4')
    expect(parsed!.components).toHaveLength(4)
    expect(parsed!.components[0]).toEqual({
      stat: 'roundsWinPct',
      value: 55.17241,
      percentile: 96.3,
    })
  })

  it('returns null when the act has no competitive segment', () => {
    expect(parseActScore({ data: [] }, act)).toBeNull()
    expect(parseActScore({}, act)).toBeNull()
    expect(parseActScore(null, act)).toBeNull()
  })

  it('returns null when the performance score is absent', () => {
    expect(parseActScore({ data: [{ stats: { kAST: { value: 1 } } }] }, act)).toBeNull()
  })

  it('returns null when the score is not numeric', () => {
    expect(
      parseActScore({ data: [{ stats: { trnPerformanceScore: { value: 'n/a' } } }] }, act)
    ).toBeNull()
  })
})

describe('recomputeScore', () => {
  it('reproduces the reported score from percentiles', () => {
    const parsed = parseActScore(segmentFixture, act)!
    // Cross-check against the value the API reported.
    expect(recomputeScore(parsed.components)).toBe(830)
  })

  it('returns null when a percentile is missing', () => {
    expect(
      recomputeScore([
        { stat: 'roundsWinPct', value: 1, percentile: null },
        { stat: 'kAST', value: 1, percentile: 50 },
      ])
    ).toBeNull()
  })

  it('returns null for an unrecognised component', () => {
    expect(recomputeScore([{ stat: 'somethingNew', value: 1, percentile: 50 }])).toBeNull()
  })

  it('returns null for an empty component list', () => {
    expect(recomputeScore([])).toBeNull()
  })
})

describe('findActById', () => {
  // Riot and tracker.gg label the same act differently — Riot's "e10a3" is
  // tracker's "E25: A3" — so only the UUID can be trusted to match them.
  const seasons = [
    { id: '4f0864e2-40af-28a4-de2c-0e9e64e75f23', shortName: 'E26: A4', name: 'Season 26 Act 4' },
    { id: 'aef237a0-494d-3a14-a1c8-ec8de84e309c', shortName: 'E25: A3', name: 'Season 25 Act 3' },
  ]

  it('matches on the Riot season UUID regardless of label', () => {
    const act = findActById(seasons, 'aef237a0-494d-3a14-a1c8-ec8de84e309c')
    expect(act?.shortName).toBe('E25: A3')
  })

  it('returns null when the act is not on the profile', () => {
    expect(findActById(seasons, 'not-a-real-id')).toBeNull()
  })

  it('returns null for a missing id', () => {
    expect(findActById(seasons, null)).toBeNull()
    expect(findActById(seasons, undefined)).toBeNull()
    expect(findActById(seasons, '')).toBeNull()
  })

  it('does not fall back to name matching', () => {
    expect(findActById(seasons, 'e10a3')).toBeNull()
    expect(findActById(seasons, 'E25: A3')).toBeNull()
  })
})

describe('pickPeak', () => {
  it('returns the highest scoring act', () => {
    const peak = pickPeak([
      { actId: '1', actShortName: 'E26: A4', score: 830, components: [] },
      { actId: '2', actShortName: 'E26: A1', score: 972, components: [] },
      { actId: '3', actShortName: 'E25: A5', score: 675, components: [] },
    ])
    expect(peak!.score).toBe(972)
    expect(peak!.actShortName).toBe('E26: A1')
  })

  it('returns null for no scores', () => {
    expect(pickPeak([])).toBeNull()
  })
})
