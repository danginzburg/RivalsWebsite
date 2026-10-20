import { describe, expect, it } from 'vitest'
import {
  computeStandings,
  roundDiffDecidesTies,
  tallyMatches,
  type StandingsMatch,
} from './compute'

const teams = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Bravo' },
  { id: 'c', name: 'Charlie' },
]

function match(overrides: Partial<StandingsMatch>): StandingsMatch {
  return {
    id: crypto.randomUUID(),
    stage: 'regular',
    team_a_id: 'a',
    team_b_id: 'b',
    team_a_score: 2,
    team_b_score: 0,
    winner_team_id: 'a',
    maps: [],
    ...overrides,
  }
}

function adjustment(teamId: string, extra: Record<string, unknown> = {}) {
  return {
    team_id: teamId,
    wins: 0,
    losses: 0,
    map_wins: 0,
    map_losses: 0,
    round_diff: 0,
    points: 0,
    rank_override: null,
    ...extra,
  }
}

describe('tallyMatches', () => {
  it('scores series, maps, rounds and points', () => {
    const lines = tallyMatches([
      match({
        team_a_score: 2,
        team_b_score: 1,
        maps: [
          { team_a_rounds: 13, team_b_rounds: 7 },
          { team_a_rounds: 10, team_b_rounds: 13 },
          { team_a_rounds: 13, team_b_rounds: 11 },
        ],
      }),
    ])
    expect(lines.get('a')).toMatchObject({
      matches_played: 1,
      wins: 1,
      losses: 0,
      map_wins: 2,
      map_losses: 1,
      round_diff: 5,
      points: 3,
    })
    expect(lines.get('b')).toMatchObject({ wins: 0, losses: 1, round_diff: -5, points: 0 })
  })

  it('skips voided maps and non-regular stages, but counts unfiled matches', () => {
    const lines = tallyMatches([
      match({ maps: [{ team_a_rounds: 13, team_b_rounds: 0, is_voided: true }] }),
      match({ stage: 'playoffs' }),
      match({ stage: null, team_a_id: 'c', team_b_id: 'b', winner_team_id: 'c' }),
    ])
    expect(lines.get('a')).toMatchObject({ matches_played: 1, round_diff: 0 })
    expect(lines.get('c')).toMatchObject({ wins: 1 })
  })
})

describe('computeStandings', () => {
  it('includes teams with no matches and sorts by points then map diff', () => {
    const rows = computeStandings(
      teams,
      [
        match({ team_a_id: 'a', team_b_id: 'b', team_a_score: 2, team_b_score: 1 }),
        match({ team_a_id: 'c', team_b_id: 'b', winner_team_id: 'c' }),
      ],
      []
    )
    expect(rows.map((r) => [r.team_id, r.rank])).toEqual([
      ['c', 1],
      ['a', 2],
      ['b', 3],
    ])
  })

  it('adds corrections on top of the calculated line', () => {
    const rows = computeStandings(teams, [match({})], [adjustment('b', { wins: 1, points: 2 })])
    const b = rows.find((r) => r.team_id === 'b')!
    expect(b.auto.points).toBe(0)
    expect(b).toMatchObject({ wins: 1, losses: 1, matches_played: 2, points: 5 })
    expect(b.rank).toBe(1)
  })

  it('gives no points outside external tournaments and ranks on record', () => {
    const rows = computeStandings(
      teams,
      [
        match({ team_a_id: 'a', team_b_id: 'b' }),
        match({ team_a_id: 'c', team_b_id: 'b', winner_team_id: 'c' }),
        match({ team_a_id: 'c', team_b_id: 'a', winner_team_id: 'c' }),
      ],
      [adjustment('a', { wins: 1 })],
      { awardPoints: false }
    )
    expect(rows.every((r) => r.points === 0)).toBe(true)
    // Level on wins, so fewer losses decides it: C is 2-0, A is 2-1.
    expect(rows.map((r) => [r.team_id, r.wins, r.losses])).toEqual([
      ['c', 2, 0],
      ['a', 2, 1],
      ['b', 0, 2],
    ])
  })

  it('breaks map-diff ties on raw map wins before round diff', () => {
    const rows = computeStandings(
      teams,
      [
        // Both +2 map diff; A has the better round diff, C the more map wins.
        match({
          team_a_id: 'a',
          team_b_id: 'b',
          team_a_score: 2,
          team_b_score: 0,
          maps: [
            { team_a_rounds: 13, team_b_rounds: 0 },
            { team_a_rounds: 13, team_b_rounds: 0 },
          ],
        }),
        match({
          team_a_id: 'c',
          team_b_id: 'b',
          winner_team_id: 'c',
          team_a_score: 3,
          team_b_score: 1,
          maps: [
            { team_a_rounds: 13, team_b_rounds: 11 },
            { team_a_rounds: 11, team_b_rounds: 13 },
            { team_a_rounds: 13, team_b_rounds: 11 },
            { team_a_rounds: 13, team_b_rounds: 11 },
          ],
        }),
      ],
      [],
      { awardPoints: false }
    )
    expect(rows.map((r) => r.team_id)).toEqual(['c', 'a', 'b'])
  })

  it('places pinned teams in their slot and fills around them', () => {
    const rows = computeStandings(
      teams,
      [match({})],
      [adjustment('b', { rank_override: 1 }), adjustment('c', { rank_override: 99 })]
    )
    expect(rows.map((r) => r.team_id)).toEqual(['b', 'a', 'c'])
  })
})

describe('roundDiffDecidesTies', () => {
  const line = (extra: Partial<Record<string, number>>) => ({
    points: 9,
    wins: 3,
    losses: 1,
    map_wins: 7,
    map_losses: 4,
    round_diff: 0,
    ...extra,
  })

  it('is true when level teams are split only by round diff', () => {
    expect(roundDiffDecidesTies([line({ round_diff: 17 }), line({ round_diff: 13 })])).toBe(true)
  })

  it('is false when raw map wins split teams level on map diff', () => {
    expect(
      roundDiffDecidesTies([
        line({ round_diff: 13 }),
        line({ map_wins: 6, map_losses: 3, round_diff: 17 }),
      ])
    ).toBe(false)
  })

  it('is false when an earlier tiebreak already separated them', () => {
    expect(
      roundDiffDecidesTies([line({ round_diff: 5 }), line({ losses: 2, round_diff: 9 })])
    ).toBe(false)
  })

  it('is false when the tied teams share a round diff too', () => {
    expect(roundDiffDecidesTies([line({ round_diff: 2 }), line({ round_diff: 2 })])).toBe(false)
  })
})
