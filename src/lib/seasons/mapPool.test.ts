import { describe, expect, it } from 'vitest'
import { mergeRotationIntoPool, resolveMapPoolMode, sanitizeMapPool } from './mapPool'

describe('mergeRotationIntoPool', () => {
  it('adds new rotation maps and keeps maps that rotated out', () => {
    const pool = ['Bind', 'Split', 'Haven']
    const rotation = ['Bind', 'Haven', 'Summit']
    expect(mergeRotationIntoPool(pool, rotation)).toEqual(['Bind', 'Split', 'Haven', 'Summit'])
  })

  it('ignores case duplicates', () => {
    expect(mergeRotationIntoPool(['Bind'], ['bind', 'Lotus'])).toEqual(['Bind', 'Lotus'])
  })
})

describe('resolveMapPoolMode', () => {
  it('treats seasons without a mode as custom', () => {
    expect(resolveMapPoolMode({})).toBe('custom')
    expect(resolveMapPoolMode(null)).toBe('custom')
    expect(resolveMapPoolMode({ map_pool_mode: 'competitive' })).toBe('competitive')
  })
})

describe('sanitizeMapPool', () => {
  it('drops blanks and non-strings', () => {
    expect(sanitizeMapPool([' Bind ', '', 3, 'Haven'])).toEqual(['Bind', 'Haven'])
  })
})
