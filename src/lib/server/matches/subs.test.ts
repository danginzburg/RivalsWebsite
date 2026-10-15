import { describe, expect, it } from 'vitest'
import {
  autoIsSub,
  isShortStint,
  matchRosterTime,
  membershipMoment,
  overrideFor,
  resolveIsSub,
  stintCovers,
  type Stint,
  type SubOverride,
  type TeamRoster,
} from './subs'

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

describe('stintCovers', () => {
  const at = (iso: string) => Date.parse(iso)
  const stint = (over: Partial<Stint> = {}): Stint => ({
    id: 1,
    team_id: 'team-a',
    profile_id: P_ROSTERED,
    player_name: null,
    puuid: null,
    joinedMs: at('2026-09-01T00:00:00Z'),
    leftMs: null,
    first: true,
    ...over,
  })

  it('keeps a departed player main roster for matches played before they left', () => {
    const old = stint({ leftMs: at('2026-09-20T18:00:00Z') })
    expect(stintCovers(old, at('2026-09-10T01:00:00Z'))).toBe(true)
    // Same day: the afternoon match was before the move, the evening one after.
    expect(stintCovers(old, at('2026-09-20T17:00:00Z'))).toBe(true)
    expect(stintCovers(old, at('2026-09-20T23:00:00Z'))).toBe(false)
  })

  it('starts a later stint at its join moment', () => {
    const next = stint({ team_id: 'team-b', joinedMs: at('2026-09-20T18:00:00Z'), first: false })
    expect(stintCovers(next, at('2026-09-20T17:00:00Z'))).toBe(false)
    expect(stintCovers(next, at('2026-09-20T23:00:00Z'))).toBe(true)
  })

  it('lets a first (backfilled) stint reach back before its join moment', () => {
    expect(stintCovers(stint({ joinedMs: at('2026-10-14T00:00:00Z') }), at('2026-08-01'))).toBe(
      true
    )
  })

  it('uses only open stints when the match has no time', () => {
    expect(stintCovers(stint(), null)).toBe(true)
    expect(stintCovers(stint({ leftMs: at('2026-09-20T18:00:00Z') }), null)).toBe(false)
  })
})

describe('membershipMoment', () => {
  it('reads timestamps as-is', () => {
    expect(membershipMoment('2026-09-20T18:00:00+00:00', 'leave')).toBe(
      Date.parse('2026-09-20T18:00:00Z')
    )
  })

  it('reads a legacy bare day as covering that whole day', () => {
    expect(membershipMoment('2026-09-20', 'join')).toBe(Date.parse('2026-09-20T00:00:00Z'))
    expect(membershipMoment('2026-09-20', 'leave')).toBe(Date.parse('2026-09-21T00:00:00Z'))
  })
})

describe('isShortStint', () => {
  it('flags a slot closed within a day of opening', () => {
    expect(isShortStint('2026-09-02T00:00:00+00:00', '2026-09-03T00:00:00+00:00')).toBe(true)
    expect(isShortStint('2026-09-02T10:00:00+00:00', '2026-09-02T10:05:00+00:00')).toBe(true)
    expect(isShortStint('2026-09-02T00:00:00+00:00', '2026-09-25T00:00:00+00:00')).toBe(false)
    expect(isShortStint('2026-09-02T00:00:00+00:00', null)).toBe(false)
  })
})

describe('matchRosterTime', () => {
  it('uses the scheduled time over the import-stamped end time', () => {
    expect(
      matchRosterTime({ scheduled_at: '2026-09-20T23:00:00Z', ended_at: '2026-10-02T01:30:00Z' })
    ).toBe(Date.parse('2026-09-20T23:00:00Z'))
    expect(matchRosterTime({ ended_at: '2026-09-21T01:30:00Z' })).toBe(
      Date.parse('2026-09-21T01:30:00Z')
    )
    expect(matchRosterTime({})).toBeNull()
  })
})
