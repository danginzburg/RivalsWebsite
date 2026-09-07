import { describe, expect, it } from 'vitest'
import {
  MIN_ROSTER_VOTES,
  resolveSeriesTeams,
  resolveSeriesTeamsManual,
  sideForTeamAByContinuity,
  type SidePlayer,
} from './match-teams'

/** Five Reds on team-a, five Blues on team-b, unless overridden. */
function roster(overrides: Record<string, string | null> = {}): {
  players: SidePlayer[]
  resolve: (riotId: string) => string | null
} {
  const players: SidePlayer[] = []
  const map: Record<string, string | null> = {}

  for (let i = 0; i < 5; i++) {
    players.push({ riotId: `red${i}#NA1`, team: 'Red' })
    map[`red${i}#NA1`] = 'team-a'
    players.push({ riotId: `blue${i}#NA1`, team: 'Blue' })
    map[`blue${i}#NA1`] = 'team-b'
  }

  Object.assign(map, overrides)
  return { players, resolve: (riotId) => map[riotId] ?? null }
}

describe('resolveSeriesTeams', () => {
  it('maps each Riot side to the team its players belong to', () => {
    const { players, resolve } = roster()
    const result = resolveSeriesTeams(players, resolve)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.resolution.teamAValorantSide).toBe('Red')
    expect(result.resolution.teamAId).toBe('team-a')
    expect(result.resolution.teamBId).toBe('team-b')
    expect(result.resolution.unmatched).toEqual([])
  })

  it('still resolves when a stand-in is on nobody the league knows', () => {
    // red4 is an unknown player: four votes still carry the side.
    const { players, resolve } = roster()
    const result = resolveSeriesTeams(players, (id) => (id === 'red4#NA1' ? null : resolve(id)))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.resolution.teamAId).toBe('team-a')
    expect(result.resolution.teamAVotes).toBe(4)
    expect(result.resolution.unmatched).toEqual(['red4#NA1'])
  })

  it('lets the majority win when a player is registered to the wrong team', () => {
    const { players, resolve } = roster({ 'red3#NA1': 'team-c' })
    const result = resolveSeriesTeams(players, resolve)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.resolution.teamAId).toBe('team-a')
    expect(result.resolution.teamAVotes).toBe(4)
  })

  it('fails rather than guessing when one side has nobody recognisable', () => {
    const { players, resolve } = roster()
    const result = resolveSeriesTeams(players, (id) => (id.startsWith('blue') ? null : resolve(id)))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.reason).toMatch(/no player on Blue is on a known roster/i)
    expect(result.failure.unmatched).toHaveLength(5)
  })

  it('refuses a side split evenly between two teams rather than picking one', () => {
    // Observed on a real import: one side had exactly one player from each of
    // two unrelated teams, and "highest count wins" chose arbitrarily.
    // Two each, so both clear the vote threshold and only the tie is at issue.
    const { players, resolve } = roster({
      'blue0#NA1': 'team-b',
      'blue1#NA1': 'team-b',
      'blue2#NA1': 'team-c',
      'blue3#NA1': 'team-c',
      'blue4#NA1': null,
    })

    const result = resolveSeriesTeams(players, resolve)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.reason).toMatch(/split evenly/i)
    // The admin needs the real candidates to choose between.
    expect(result.failure.candidates).toEqual(
      expect.arrayContaining([
        { side: 'Blue', teamId: 'team-b', votes: 2 },
        { side: 'Blue', teamId: 'team-c', votes: 2 },
      ])
    )
  })

  it(`refuses when a side has fewer than ${MIN_ROSTER_VOTES} recognised players`, () => {
    const { players, resolve } = roster()
    const result = resolveSeriesTeams(players, (id) =>
      id.startsWith('blue') && id !== 'blue0#NA1' ? null : resolve(id)
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.reason).toMatch(/only 1 recognised player on Blue/i)
  })

  it(`accepts a side with exactly ${MIN_ROSTER_VOTES} recognised players`, () => {
    const { players, resolve } = roster()
    const result = resolveSeriesTeams(players, (id) =>
      id.startsWith('blue') && !['blue0#NA1', 'blue1#NA1'].includes(id) ? null : resolve(id)
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.resolution.teamBId).toBe('team-b')
    expect(result.resolution.teamBVotes).toBe(MIN_ROSTER_VOTES)
  })

  it('fails when both sides resolve to the same team', () => {
    const { players, resolve } = roster()
    const result = resolveSeriesTeams(players, (id) => (resolve(id) ? 'team-a' : null))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.reason).toMatch(/same team/i)
  })

  it('fails when the match does not have exactly two sides', () => {
    const result = resolveSeriesTeams([{ riotId: 'a#NA1', team: 'Red' }], () => 'team-a')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.reason).toMatch(/found 1/)
  })
})

describe('sideForTeamAByContinuity', () => {
  // Five players carried from map 1's team-A side.
  const anchor = new Set(['p1', 'p2', 'p3', 'p4', 'p5'])
  const withPuuid = (team: string, puuid: string) => ({ team, puuid })

  it('follows the anchor roster to whichever side it sits on after a swap', () => {
    // Same five players, now on Red instead of Blue; the other five on Blue.
    const players = [
      withPuuid('Red', 'p1'),
      withPuuid('Red', 'p2'),
      withPuuid('Red', 'p3'),
      withPuuid('Red', 'p4'),
      withPuuid('Red', 'p5'),
      withPuuid('Blue', 'q1'),
      withPuuid('Blue', 'q2'),
      withPuuid('Blue', 'q3'),
      withPuuid('Blue', 'q4'),
      withPuuid('Blue', 'q5'),
    ]
    expect(sideForTeamAByContinuity(anchor, players)).toBe('Red')
  })

  it('returns the same side when the roster has not swapped', () => {
    const players = [
      withPuuid('Blue', 'p1'),
      withPuuid('Blue', 'p2'),
      withPuuid('Blue', 'p3'),
      withPuuid('Red', 'q1'),
      withPuuid('Red', 'q2'),
    ]
    expect(sideForTeamAByContinuity(anchor, players)).toBe('Blue')
  })

  it('still decides on a majority when a stand-in replaces one anchor player', () => {
    // Four of the five anchor players are on Red; a sub took the fifth slot.
    const players = [
      withPuuid('Red', 'p1'),
      withPuuid('Red', 'p2'),
      withPuuid('Red', 'p3'),
      withPuuid('Red', 'p4'),
      withPuuid('Red', 'sub'),
      withPuuid('Blue', 'q1'),
    ]
    expect(sideForTeamAByContinuity(anchor, players)).toBe('Red')
  })

  it('returns null when the anchor roster is split evenly across both sides', () => {
    const players = [
      withPuuid('Red', 'p1'),
      withPuuid('Red', 'p2'),
      withPuuid('Blue', 'p3'),
      withPuuid('Blue', 'p4'),
    ]
    expect(sideForTeamAByContinuity(anchor, players)).toBeNull()
  })

  it('returns null when none of the anchor roster is present', () => {
    const players = [withPuuid('Red', 'x'), withPuuid('Blue', 'y')]
    expect(sideForTeamAByContinuity(anchor, players)).toBeNull()
  })

  it('returns null for an empty anchor set', () => {
    expect(sideForTeamAByContinuity(new Set(), [withPuuid('Red', 'p1')])).toBeNull()
  })
})

describe('resolveSeriesTeamsManual', () => {
  it('puts team A on the side where its roster is recognised', () => {
    // Only one recognised player per side — too few for the automatic path,
    // but enough to tell which side each hand-picked team is on.
    const players: SidePlayer[] = [
      { riotId: 'red0#NA1', team: 'Red' },
      { riotId: 'blue0#NA1', team: 'Blue' },
    ]
    const resolve = (id: string) =>
      id === 'red0#NA1' ? 'team-a' : id === 'blue0#NA1' ? 'team-b' : null

    const result = resolveSeriesTeamsManual(players, resolve, 'team-a', 'team-b')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.resolution.teamAValorantSide).toBe('Red')
    expect(result.resolution.teamAId).toBe('team-a')
    expect(result.resolution.teamBId).toBe('team-b')
  })

  it('flips the side when team A is the one on Blue', () => {
    const players: SidePlayer[] = [
      { riotId: 'red0#NA1', team: 'Red' },
      { riotId: 'blue0#NA1', team: 'Blue' },
    ]
    const resolve = (id: string) =>
      id === 'red0#NA1' ? 'team-b' : id === 'blue0#NA1' ? 'team-a' : null

    const result = resolveSeriesTeamsManual(players, resolve, 'team-a', 'team-b')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.resolution.teamAValorantSide).toBe('Blue')
  })

  it('defaults team A to the first side when no players are recognised', () => {
    const players: SidePlayer[] = [
      { riotId: 'x#NA1', team: 'Red' },
      { riotId: 'y#NA1', team: 'Blue' },
    ]

    const result = resolveSeriesTeamsManual(players, () => null, 'team-a', 'team-b')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.resolution.teamAValorantSide).toBe('Red')
    expect(result.resolution.unmatched).toEqual(['x#NA1', 'y#NA1'])
  })

  it('reports players on neither chosen team as unmatched', () => {
    const players: SidePlayer[] = [
      { riotId: 'red0#NA1', team: 'Red' },
      { riotId: 'red1#NA1', team: 'Red' },
      { riotId: 'blue0#NA1', team: 'Blue' },
    ]
    const resolve = (id: string) =>
      id === 'red0#NA1' ? 'team-a' : id === 'blue0#NA1' ? 'team-b' : 'team-z'

    const result = resolveSeriesTeamsManual(players, resolve, 'team-a', 'team-b')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.resolution.unmatched).toEqual(['red1#NA1'])
  })

  it('fails when the match does not have exactly two sides', () => {
    const result = resolveSeriesTeamsManual(
      [{ riotId: 'a#NA1', team: 'Red' }],
      () => 'team-a',
      'team-a',
      'team-b'
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.reason).toMatch(/found 1/)
  })
})
