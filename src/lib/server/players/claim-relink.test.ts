import { describe, expect, it } from 'vitest'
import { buildProfileMatcher } from '$lib/server/imports/matching'
import { normalizedProfileNameKeys } from '$lib/server/players/claim-relink'

describe('normalizedProfileNameKeys', () => {
  it('collects unique normalized names from profile fields', () => {
    const keys = normalizedProfileNameKeys({
      id: 'x',
      display_name: 'Foo Bar',
      riot_id_base: 'foo bar',
      stats_player_name: 'Other',
    })
    expect(keys.has('foo bar')).toBe(true)
    expect(keys.has('other')).toBe(true)
    expect(keys.size).toBe(2)
  })

  it('omits empty fields', () => {
    const keys = normalizedProfileNameKeys({
      id: 'x',
      display_name: null,
      riot_id_base: 'rize',
      stats_player_name: null,
    })
    expect(keys.has('rize')).toBe(true)
    expect(keys.size).toBe(1)
  })
})

describe('buildProfileMatcher (used by match map relink)', () => {
  it('resolves tag suffix to profile id', () => {
    const id = '49a4217d-7052-4cfe-a6b3-6d521a46b2b6'
    const matcher = buildProfileMatcher([
      {
        id,
        display_name: null,
        riot_id_base: 'rize',
        stats_player_name: null,
      },
    ])
    expect(matcher.resolve('rize')).toBe(id)
    expect(matcher.resolve('rize#1234')).toBe(id)
    expect(matcher.resolve('RIZE')).toBe(id)
  })
})
