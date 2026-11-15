import { describe, expect, it } from 'vitest'
import { fitWithin, renameForType } from './shrink-logo'

describe('fitWithin', () => {
  it('scales the long side down to the max', () => {
    expect(fitWithin(2000, 1000)).toEqual({ width: 256, height: 128 })
    expect(fitWithin(500, 1000)).toEqual({ width: 128, height: 256 })
  })

  it('never scales up', () => {
    expect(fitWithin(100, 80)).toEqual({ width: 100, height: 80 })
  })

  it('keeps at least one pixel on extreme aspect ratios', () => {
    expect(fitWithin(10000, 1)).toEqual({ width: 256, height: 1 })
  })
})

describe('renameForType', () => {
  it('swaps the extension to match the encoded type', () => {
    expect(renameForType('Team Logo.png', 'image/webp')).toBe('Team Logo.webp')
    expect(renameForType('logo.jpeg', 'image/png')).toBe('logo.png')
  })

  it('handles names without an extension', () => {
    expect(renameForType('logo', 'image/webp')).toBe('logo.webp')
    expect(renameForType('', 'image/webp')).toBe('logo.webp')
  })
})
