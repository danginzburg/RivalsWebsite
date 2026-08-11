import { describe, expect, it } from 'vitest'

import { isLeagueRank, toLeagueRank } from './rank-map'

describe('toLeagueRank', () => {
  it('maps every Riot tier straight across', () => {
    expect(toLeagueRank('Iron 1')).toBe('Iron 1')
    expect(toLeagueRank('Bronze 3')).toBe('Bronze 3')
    expect(toLeagueRank('Silver 2')).toBe('Silver 2')
    expect(toLeagueRank('Gold 3')).toBe('Gold 3')
    expect(toLeagueRank('Platinum 1')).toBe('Platinum 1')
    expect(toLeagueRank('Diamond 2')).toBe('Diamond 2')
    expect(toLeagueRank('Ascendant 3')).toBe('Ascendant 3')
    expect(toLeagueRank('Immortal 1')).toBe('Immortal 1')
    expect(toLeagueRank('Immortal 3')).toBe('Immortal 3')
    expect(toLeagueRank('Radiant')).toBe('Radiant')
  })

  it('normalises spacing and casing', () => {
    expect(toLeagueRank('  diamond   2  ')).toBe('Diamond 2')
    expect(toLeagueRank('IMMORTAL 2')).toBe('Immortal 2')
    expect(toLeagueRank('radiant')).toBe('Radiant')
  })

  it('tolerates a sub-tier appended to Radiant', () => {
    expect(toLeagueRank('Radiant 1')).toBe('Radiant')
  })

  it('returns null for unplaced accounts so an admin decides, not the mapper', () => {
    // "Unrated" is what the live API returns for an unplaced account.
    expect(toLeagueRank('Unrated')).toBeNull()
    expect(toLeagueRank('unrated')).toBeNull()
    expect(toLeagueRank('Unranked')).toBeNull()
    expect(toLeagueRank('unranked')).toBeNull()
  })

  it('returns null for missing or unrecognised tiers', () => {
    expect(toLeagueRank(null)).toBeNull()
    expect(toLeagueRank(undefined)).toBeNull()
    expect(toLeagueRank('')).toBeNull()
    expect(toLeagueRank('   ')).toBeNull()
    expect(toLeagueRank('Bronze 9')).toBeNull()
    expect(toLeagueRank('Challenger')).toBeNull()
  })

  it('never returns a name outside the league scale', () => {
    const samples = [
      'Iron 1',
      'Ascendant 2',
      'Immortal 3',
      'Radiant',
      'Radiant 2',
      'Unranked',
      'Nonsense',
      '',
    ]
    for (const s of samples) {
      const mapped = toLeagueRank(s)
      if (mapped !== null) expect(isLeagueRank(mapped)).toBe(true)
    }
  })
})

describe('isLeagueRank', () => {
  it('accepts known names and rejects others', () => {
    expect(isLeagueRank('Diamond 2')).toBe(true)
    expect(isLeagueRank('Radiant')).toBe(true)
    expect(isLeagueRank('Immortal 4')).toBe(false)
    expect(isLeagueRank(null)).toBe(false)
  })
})
