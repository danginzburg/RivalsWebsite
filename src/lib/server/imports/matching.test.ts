import { describe, expect, it } from 'vitest'
import { buildProfileMatcher } from './matching'

const OWNER = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'

describe('buildProfileMatcher — PUUID and alias resolution', () => {
  it('resolves by PUUID even when the name has changed', () => {
    const matcher = buildProfileMatcher(
      [{ id: OWNER, display_name: 'OldName' }],
      [{ profile_id: OWNER, riot_name: 'OldName', riot_tag: 'NA1', riot_puuid: 'puuid-owner' }]
    )
    // A later match reports a new name but the same PUUID.
    expect(matcher.resolve('BrandNewName#NA1', 'puuid-owner')).toBe(OWNER)
    expect(matcher.resolveByPuuid('puuid-owner')).toBe(OWNER)
  })

  it('resolves an alt account name to the owning profile', () => {
    const matcher = buildProfileMatcher(
      [{ id: OWNER, display_name: 'Main' }],
      [
        { profile_id: OWNER, riot_name: 'Main', riot_tag: 'NA1', riot_puuid: 'p-main' },
        { profile_id: OWNER, riot_name: 'SmurfAccount', riot_tag: 'EU1', riot_puuid: 'p-alt' },
      ]
    )
    expect(matcher.resolve('SmurfAccount#EU1')).toBe(OWNER)
    expect(matcher.resolve('SmurfAccount')).toBe(OWNER)
    expect(matcher.resolve('anyone', 'p-alt')).toBe(OWNER)
  })

  it('lets PUUID win over a name that points elsewhere', () => {
    const matcher = buildProfileMatcher(
      [
        { id: OWNER, display_name: 'Owner' },
        { id: OTHER, display_name: 'Shared' },
      ],
      [{ profile_id: OWNER, riot_name: 'Owner', riot_tag: 'NA1', riot_puuid: 'p-owner' }]
    )
    // Name 'Shared' resolves to OTHER, but the PUUID is the owner's.
    expect(matcher.resolve('Shared', 'p-owner')).toBe(OWNER)
    expect(matcher.resolve('Shared')).toBe(OTHER)
  })

  it('falls back to name when no PUUID is supplied', () => {
    const matcher = buildProfileMatcher(
      [{ id: OWNER, display_name: null }],
      [{ profile_id: OWNER, riot_name: 'rize', riot_tag: null, riot_puuid: null }]
    )
    expect(matcher.resolve('rize')).toBe(OWNER)
    expect(matcher.resolve('rize#1234')).toBe(OWNER)
    expect(matcher.resolve('unknown')).toBeNull()
  })

  it('account rows override a clashing display name', () => {
    const matcher = buildProfileMatcher(
      [
        // Stale display name on the wrong profile.
        { id: OTHER, display_name: 'Ambiguous' },
      ],
      [{ profile_id: OWNER, riot_name: 'Ambiguous', riot_tag: 'NA1', riot_puuid: 'p-x' }]
    )
    expect(matcher.resolve('Ambiguous')).toBe(OWNER)
  })
})
