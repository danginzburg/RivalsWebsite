import { describe, expect, it } from 'vitest'

import { recordEntryKey } from './overrides'

describe('recordEntryKey', () => {
  it('names a player performance by its map and stat row', () => {
    expect(recordEntryKey('map-1', 42)).toBe('map-1:42')
  })

  it('names a team performance by its map alone', () => {
    expect(recordEntryKey('map-1', null)).toBe('map-1:')
  })
})
