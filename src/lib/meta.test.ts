import { describe, expect, it } from 'vitest'
import { joinDescription, leagueTime, statText } from './meta'

describe('joinDescription', () => {
  it('joins the parts that exist', () => {
    expect(joinDescription(['Season 4', null, '', false, '10–6 in series'])).toBe(
      'Season 4 · 10–6 in series'
    )
  })

  it('trims long text to what a preview shows', () => {
    const text = joinDescription(['x'.repeat(400)])
    expect(text.length).toBeLessThanOrEqual(300)
    expect(text.endsWith('…')).toBe(true)
  })
})

describe('leagueTime', () => {
  it('shows a UTC time on Central time', () => {
    // 01:00 UTC on 19 May is 8:00 PM CDT on the 18th.
    expect(leagueTime('2025-05-19T01:00:00Z')).toBe('Sun, May 18, 8:00 PM CT')
  })

  it('returns null for missing or bad dates', () => {
    expect(leagueTime(null)).toBeNull()
    expect(leagueTime('not a date')).toBeNull()
  })
})

describe('statText', () => {
  it('formats numbers and skips missing ones', () => {
    expect(statText(1.2345, 2)).toBe('1.23')
    expect(statText('262.4')).toBe('262')
    expect(statText(null)).toBeNull()
    expect(statText('')).toBeNull()
  })
})
