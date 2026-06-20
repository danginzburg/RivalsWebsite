import { describe, expect, it } from 'vitest'

import { statsRowKey } from './ui'

describe('stats ui helpers', () => {
  it('keys duplicate profile rows by unique stats row id', () => {
    const rows = [
      { id: 'stats-146', profile_id: 'profile-1', player_name: 'Player' },
      { id: 'stats-178', profile_id: 'profile-1', player_name: 'Player' },
    ]

    expect(rows.map((row, index) => statsRowKey(row, index))).toEqual([
      'row:stats-146',
      'row:stats-178',
    ])
  })

  it('keeps fallback keys unique when row id is missing', () => {
    const rows = [
      { profile_id: 'profile-1', player_name: 'Player' },
      { profile_id: 'profile-1', player_name: 'Player' },
      { player_name: 'Unclaimed' },
      { player_name: 'Unclaimed' },
    ]

    expect(new Set(rows.map((row, index) => statsRowKey(row, index))).size).toBe(rows.length)
  })
})
