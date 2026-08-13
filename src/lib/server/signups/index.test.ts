import { describe, expect, it } from 'vitest'

import { normalizeTrackerLinks, normalizeDiscordHandle, parseScore } from './index'

describe('normalizeTrackerLinks', () => {
  it('derives the label from the hostname', () => {
    const links = normalizeTrackerLinks([
      { label: '', url: 'https://tracker.gg/valorant/profile/riot/Name%23TAG' },
    ])

    expect(links).toHaveLength(1)
    expect(links[0].label).toBe('tracker.gg')
  })

  it('strips a www prefix from the derived label', () => {
    const links = normalizeTrackerLinks([{ label: '', url: 'https://www.op.gg/valorant/x' }])
    expect(links[0].label).toBe('op.gg')
  })

  it('drops entries with an unparseable url', () => {
    const links = normalizeTrackerLinks([
      { label: '', url: 'not a url' },
      { label: '', url: 'https://tracker.gg/ok' },
    ])

    expect(links).toHaveLength(1)
    expect(links[0].url).toContain('tracker.gg')
  })

  it('rejects non-http protocols', () => {
    const links = normalizeTrackerLinks([
      { label: '', url: 'javascript:alert(1)' },
      { label: '', url: 'ftp://example.com/x' },
    ])

    expect(links).toHaveLength(0)
  })

  it('ignores blank urls', () => {
    const links = normalizeTrackerLinks([
      { label: '', url: '' },
      { label: '', url: '   ' },
    ])
    expect(links).toHaveLength(0)
  })

  it('caps the number of links', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      label: '',
      url: `https://tracker.gg/${i}`,
    }))
    expect(normalizeTrackerLinks(many).length).toBeLessThanOrEqual(5)
  })

  it('returns an empty array for non-array input', () => {
    expect(normalizeTrackerLinks(null)).toEqual([])
    expect(normalizeTrackerLinks('nope')).toEqual([])
  })
})

describe('normalizeDiscordHandle', () => {
  it('strips leading @ signs', () => {
    expect(normalizeDiscordHandle('@someone')).toBe('someone')
    expect(normalizeDiscordHandle('@@someone')).toBe('someone')
  })

  it('trims and returns null for blanks', () => {
    expect(normalizeDiscordHandle('  ')).toBeNull()
    expect(normalizeDiscordHandle(null)).toBeNull()
  })

  it('preserves an ordinary handle', () => {
    expect(normalizeDiscordHandle('ginzburg')).toBe('ginzburg')
  })
})

describe('parseScore', () => {
  it('parses numeric input', () => {
    expect(parseScore('1500')).toBe(1500)
    expect(parseScore(42)).toBe(42)
  })

  it('treats blank and invalid input as absent', () => {
    expect(parseScore('')).toBeNull()
    expect(parseScore(null)).toBeNull()
    expect(parseScore(undefined)).toBeNull()
    expect(parseScore('abc')).toBeNull()
  })

  it('treats negative scores as absent', () => {
    expect(parseScore(-10)).toBeNull()
  })
})
