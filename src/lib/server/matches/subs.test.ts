import { describe, expect, it } from 'vitest'
import { autoIsSub, overrideFor, resolveIsSub, type SubOverride, type TeamRoster } from './subs'

const P_ROSTERED = '11111111-1111-1111-1111-111111111111'
const P_OTHER = '22222222-2222-2222-2222-222222222222'

function roster(over: Partial<TeamRoster> = {}): TeamRoster {
  return {
    profileIds: new Set(),
    names: new Set(),
    puuids: new Set(),
    ...over,
  }
}

describe('autoIsSub', () => {
  it('treats an empty/unknown roster as "not a sub" rather than flagging everyone', () => {
    expect(autoIsSub(undefined, P_OTHER, 'Anyone#NA1', 'puuid-x')).toBe(false)
    expect(autoIsSub(roster(), P_OTHER, 'Anyone#NA1', 'puuid-x')).toBe(false)
  })

  it('matches a rostered profile id', () => {
    const r = roster({ profileIds: new Set([P_ROSTERED]) })
    expect(autoIsSub(r, P_ROSTERED, 'Whatever#NA1')).toBe(false)
    expect(autoIsSub(r, P_OTHER, 'Whatever#NA1')).toBe(true)
  })

  it('matches on the tag-stripped base name', () => {
    const r = roster({ names: new Set(['general']) })
    // Stat row carries the full Riot ID; the roster stored the base.
    expect(autoIsSub(r, null, 'General#5872')).toBe(false)
  })

  it('matches on PUUID even when the name has since changed', () => {
    const r = roster({ puuids: new Set(['puuid-pickles']) })
    expect(autoIsSub(r, null, 'CompletelyNewName#TTV', 'puuid-pickles')).toBe(false)
    expect(autoIsSub(r, null, 'CompletelyNewName#TTV', 'puuid-other')).toBe(true)
  })

  it('flags a genuine sub not present by any key', () => {
    const r = roster({ profileIds: new Set([P_ROSTERED]), names: new Set(['pickles']) })
    expect(autoIsSub(r, P_OTHER, 'RandomSub#XYZ', 'puuid-sub')).toBe(true)
  })
})

describe('overrideFor', () => {
  const overrides: SubOverride[] = [
    { id: '1', match_id: 'm', puuid: 'puuid-a', player_name: null, is_sub: true, note: null },
    { id: '2', match_id: 'm', puuid: null, player_name: 'NameOnly#1', is_sub: false, note: null },
  ]

  it('resolves by puuid first', () => {
    expect(overrideFor(overrides, 'puuid-a', 'irrelevant')).toBe(true)
  })

  it('resolves a name-keyed override case-insensitively', () => {
    expect(overrideFor(overrides, null, 'nameonly#1')).toBe(false)
  })

  it('returns null when no override applies', () => {
    expect(overrideFor(overrides, 'puuid-z', 'Unknown#9')).toBeNull()
  })
})

describe('resolveIsSub', () => {
  it('lets an override win over the auto rule', () => {
    const r = roster({ puuids: new Set(['puuid-starter']) })
    // Auto would say starter, but the override forces sub.
    const overrides: SubOverride[] = [
      {
        id: '1',
        match_id: 'm',
        puuid: 'puuid-starter',
        player_name: null,
        is_sub: true,
        note: null,
      },
    ]
    expect(
      resolveIsSub({
        overrides,
        roster: r,
        profileId: null,
        playerName: 'X#1',
        puuid: 'puuid-starter',
      })
    ).toBe(true)
  })

  it('falls back to the auto rule with no override', () => {
    const r = roster({ profileIds: new Set([P_ROSTERED]) })
    expect(
      resolveIsSub({
        overrides: [],
        roster: r,
        profileId: P_ROSTERED,
        playerName: 'X#1',
        puuid: null,
      })
    ).toBe(false)
  })
})
