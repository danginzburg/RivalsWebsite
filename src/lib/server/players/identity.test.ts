import { describe, expect, it } from 'vitest'
import { buildIdentityIndex } from './identity'

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

describe('buildIdentityIndex', () => {
  it('gives up on a name two profiles answer to', () => {
    const index = buildIdentityIndex(
      [],
      [
        { profile_id: A, riot_name: 'Twin', riot_tag: 'NA1' },
        { profile_id: B, riot_name: 'Twin', riot_tag: 'EU1' },
      ]
    )
    expect(index.resolve('Twin')).toBeNull()
    // The full Riot ID is still unique.
    expect(index.resolve('Twin#EU1')).toBe(B)
  })

  it('does not fall back to a display name when account names clash', () => {
    const index = buildIdentityIndex(
      [{ id: A, display_name: 'Twin' }],
      [
        { profile_id: A, riot_name: 'Twin' },
        { profile_id: B, riot_name: 'Twin' },
      ]
    )
    expect(index.resolve('Twin')).toBeNull()
  })

  it('treats one profile known by the same name twice as unique', () => {
    const index = buildIdentityIndex(
      [{ id: A, display_name: 'Solo' }],
      [{ profile_id: A, riot_name: 'Solo', riot_tag: 'NA1', riot_puuid: 'p-a' }]
    )
    expect(index.resolve('solo')).toBe(A)
    expect(index.resolve('Solo#NA1')).toBe(A)
  })
})
