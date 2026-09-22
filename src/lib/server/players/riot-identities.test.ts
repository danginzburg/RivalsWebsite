import { describe, expect, it } from 'vitest'
import { dedupeObservations } from './riot-identities'

describe('dedupeObservations', () => {
  it('collapses repeated PUUIDs to one row, keeping the latest name', () => {
    const rows = dedupeObservations([
      { puuid: 'p1', name: 'OldName', tag: 'NA1' },
      { puuid: 'p2', name: 'Someone', tag: 'EU2' },
      // Same player, later map, new name — last write wins.
      { puuid: 'p1', name: 'NewName', tag: 'NA1' },
    ])

    expect(rows).toHaveLength(2)
    const p1 = rows.find((r) => r.puuid === 'p1')
    expect(p1?.name).toBe('NewName')
    expect(p1?.tag).toBe('NA1')
  })

  it('drops rows with no PUUID and trims/normalizes blanks to null', () => {
    const rows = dedupeObservations([
      { puuid: '', name: 'NoId', tag: 'NA1' },
      { puuid: null, name: 'AlsoNoId', tag: 'NA1' },
      { puuid: '  p3  ', name: '  ', tag: '' },
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({ puuid: 'p3', name: null, tag: null })
  })
})
