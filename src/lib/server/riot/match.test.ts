import { describe, expect, it } from 'vitest'
import { roundStartTime } from './match'

describe('roundStartTime', () => {
  it('snaps to the nearest quarter hour', () => {
    expect(roundStartTime('2026-10-22T00:07:43Z')).toBe('2026-10-22T00:15:00.000Z')
    expect(roundStartTime('2026-10-22T00:07:29Z')).toBe('2026-10-22T00:00:00.000Z')
    expect(roundStartTime('2026-10-22T23:53:00Z')).toBe('2026-10-23T00:00:00.000Z')
  })

  it('passes through missing or unparseable values', () => {
    expect(roundStartTime(null)).toBeNull()
    expect(roundStartTime('not a date')).toBe('not a date')
  })
})
