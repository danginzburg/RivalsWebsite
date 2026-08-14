import { describe, expect, it } from 'vitest'
import { MIN_ROSTER_VOTES, resolveSeriesTeams, type SidePlayer } from './match-teams'

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
