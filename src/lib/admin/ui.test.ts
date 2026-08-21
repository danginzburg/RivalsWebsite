import { describe, expect, it } from 'vitest'

import {
  buildApprovedTeamOptions,
  filterAdminMatches,
  normalizeSearchValue,
  profileLabel,
} from './ui'
import { fromDatetimeLocal, toDatetimeLocal } from './match-ui'

describe('admin ui helpers', () => {
  it('normalizes search values by trimming and lowercasing', () => {
    expect(normalizeSearchValue('  Mixed Case Query  ')).toBe('mixed case query')
  })

  it('formats profile labels from arrays, objects, and empty values', () => {
    expect(profileLabel([{ display_name: 'Captain' }])).toBe('Captain')
    expect(profileLabel({ email: 'player@example.com' })).toBe('player@example.com')
    expect(profileLabel(null)).toBe('—')
  })

  it('filters admin matches by query and completed visibility', () => {
    const matches = [
      {
        id: 'm1',
        status: 'scheduled',
        team_a: { name: 'Alpha' },
        team_b: { name: 'Bravo' },
      },
      {
        id: 'm2',
        status: 'completed',
        team_a: { name: 'Crimson' },
        team_b: { name: 'Delta' },
      },
    ]

    expect(filterAdminMatches(matches, '', false)).toEqual([matches[0]])
    expect(filterAdminMatches(matches, 'delta', true)).toEqual([matches[1]])
    expect(filterAdminMatches(matches, 'scheduled', true)).toEqual([matches[0]])
  })

  it('round-trips datetime-local values through UTC without shifting wall-clock time', () => {
    // fromDatetimeLocal interprets the bare string in the local zone (as the
    // browser would); toDatetimeLocal renders the stored UTC back to local. The
    // wall-clock value the admin typed must survive the round trip regardless
    // of the test runner's timezone.
    const local = '2026-08-21T14:00'
    const stored = fromDatetimeLocal(local)
    expect(stored).not.toBeNull()
    expect(stored).toMatch(/Z$/) // absolute instant, not a bare local string
    expect(toDatetimeLocal(stored)).toBe(local)
  })

  it('treats empty datetime-local input as null', () => {
    expect(fromDatetimeLocal('')).toBeNull()
    expect(fromDatetimeLocal(null)).toBeNull()
    expect(fromDatetimeLocal('not-a-date')).toBeNull()
  })

  it('builds approved team options with uppercase tags', () => {
    expect(
      buildApprovedTeamOptions([
        { id: 'team-1', name: 'Phoenix', tag: 'phx' },
        { id: 'team-2', name: 'Orbit', tag: null },
      ])
    ).toEqual([
      { label: 'Phoenix [PHX]', value: 'team-1' },
      { label: 'Orbit', value: 'team-2' },
    ])
  })
})
