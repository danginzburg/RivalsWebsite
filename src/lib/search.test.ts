import { describe, expect, it } from 'vitest'
import { normalizeSearch, searchIndex, type SearchIndex } from './search'

const index: SearchIndex = {
  players: [
    {
      id: 'p1',
      name: 'Aceman',
      riotIds: ['ace', 'ace#NA1'],
      avatarUrl: null,
      team: null,
      teamSeason: null,
    },
    {
      id: 'p2',
      name: 'Big Moxie',
      riotIds: ['zzz#000'],
      avatarUrl: null,
      team: null,
      teamSeason: null,
    },
    {
      id: 'p3',
      name: 'Grace',
      riotIds: ['acer#111'],
      avatarUrl: null,
      team: null,
      teamSeason: null,
    },
  ],
  teams: [
    {
      id: 't2',
      name: 'Ace Squad',
      tag: 'ACE',
      logoUrl: null,
      season: 'S5',
      seasonStartsOn: '2026-09-01',
      external: false,
    },
    {
      id: 't1',
      name: 'Ace Squad',
      tag: 'ACE',
      logoUrl: null,
      season: 'S4',
      seasonStartsOn: '2026-05-01',
      external: false,
    },
    {
      id: 't3',
      name: 'Ace Shitters',
      tag: null,
      logoUrl: null,
      season: 'SL',
      seasonStartsOn: '2026-06-01',
      external: true,
    },
  ],
}

describe('normalizeSearch', () => {
  it('lowercases, strips accents and punctuation but keeps #', () => {
    expect(normalizeSearch('  Café_Boy#NA1 ')).toBe('cafe boy#na1')
  })
})

describe('searchIndex', () => {
  it('returns nothing for an empty query', () => {
    expect(searchIndex(index, '   ')).toEqual({ players: [], teams: [] })
  })

  it('ranks prefix matches above word and substring matches', () => {
    const ids = searchIndex(index, 'ace').players.map((p) => p.id)
    // Aceman: name prefix; Grace: riot ID prefix "acer" (below name bonus) and name substring.
    expect(ids).toEqual(['p1', 'p3'])
  })

  it('finds a player by a Riot ID with its tag', () => {
    expect(searchIndex(index, 'zzz#000').players.map((p) => p.id)).toEqual(['p2'])
  })

  it('matches the start of a later word', () => {
    expect(searchIndex(index, 'mox').players.map((p) => p.id)).toEqual(['p2'])
  })

  it('keeps every season of a recurring team, newest first, and hides external events', () => {
    expect(searchIndex(index, 'ace').teams.map((t) => t.id)).toEqual(['t2', 't1'])
    expect(searchIndex(index, 'ace', { includeExternal: true }).teams.map((t) => t.id)).toEqual([
      't2',
      't1',
      't3',
    ])
  })
})
