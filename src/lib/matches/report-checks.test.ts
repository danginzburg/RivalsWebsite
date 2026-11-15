import { describe, expect, it } from 'vitest'

import { checkSeriesScore, seriesScore } from './report-checks'

const w = (a: number, b: number) => ({ teamARounds: a, teamBRounds: b })

describe('checkSeriesScore', () => {
  it('accepts a 2-0 and a 2-1 best-of-three', () => {
    expect(checkSeriesScore([w(13, 5), w(13, 11)], 3)).toBeNull()
    expect(checkSeriesScore([w(13, 5), w(9, 13), w(14, 12)], 3)).toBeNull()
  })

  it('accepts a 3-2 best-of-five', () => {
    expect(checkSeriesScore([w(13, 5), w(9, 13), w(5, 13), w(13, 3), w(13, 10)], 5)).toBeNull()
  })

  it('rejects a series that is not finished', () => {
    expect(checkSeriesScore([w(13, 5), w(9, 13)], 3)).toMatch(/1-1/)
    expect(checkSeriesScore([w(13, 5)], 3)).toMatch(/1-0/)
  })

  it('rejects maps played after the series was decided', () => {
    expect(checkSeriesScore([w(13, 5), w(13, 5), w(5, 13)], 3)).toMatch(/Map 3/)
  })

  it('rejects more maps than the best-of allows', () => {
    expect(checkSeriesScore([w(13, 5), w(5, 13), w(13, 5), w(5, 13)], 3)).toMatch(/4 maps/)
  })

  it('rejects a map with no winner', () => {
    expect(checkSeriesScore([w(13, 5), w(12, 12)], 3)).toMatch(/Map 2/)
  })

  it('rejects an empty submission', () => {
    expect(checkSeriesScore([], 3)).toMatch(/No maps/)
  })
})

describe('seriesScore', () => {
  it('counts map wins per side', () => {
    expect(seriesScore([w(13, 5), w(9, 13), w(14, 12)])).toEqual({ a: 2, b: 1 })
  })
})
