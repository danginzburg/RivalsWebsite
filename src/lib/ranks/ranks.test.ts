import { describe, expect, it } from 'vitest'
import { rankImageKey, rankLabel, rankValue } from './ranks'

describe('Immortal RR ranks', () => {
  it('reads RR as the Immortal tier it falls in', () => {
    expect(rankLabel('Immortal 0RR')).toBe('Immortal 1')
    expect(rankLabel('Immortal 89RR')).toBe('Immortal 1')
    expect(rankLabel('Immortal 90RR')).toBe('Immortal 2')
    expect(rankLabel('Immortal 200RR')).toBe('Immortal 3')
    expect(rankImageKey('Immortal 120RR')).toBe('Immortal_2_Rank')
  })

  it('ranks RR and tier forms on one scale', () => {
    expect(rankValue('Immortal 90RR')).toBeGreaterThan(rankValue('Immortal 1'))
    expect(rankValue('Immortal 90RR')).toBeLessThan(rankValue('Immortal 3'))
    expect(rankValue('Immortal 200RR')).toBeLessThan(rankValue('Radiant'))
    expect(rankValue('Immortal 150RR')).toBeGreaterThan(rankValue('Immortal 100RR'))
  })

  it('leaves other ranks as they are', () => {
    expect(rankLabel('Gold 2')).toBe('Gold 2')
    expect(rankLabel('Radiant')).toBe('Radiant')
    expect(rankLabel(null)).toBeNull()
  })
})
