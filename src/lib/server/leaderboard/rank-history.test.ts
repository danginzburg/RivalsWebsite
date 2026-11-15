import { describe, expect, it } from 'vitest'
import { weeklyRanks, type DatedStandingsMatch } from './rank-history'

const teams = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Bravo' },
  { id: 'c', name: 'Charlie' },
]

function match(at: string, winner: 'a' | 'b' | 'c', loser: 'a' | 'b' | 'c'): DatedStandingsMatch {
  return {
    id: crypto.randomUUID(),
    stage: 'regular',
    at,
    team_a_id: winner,
    team_b_id: loser,
    team_a_score: 2,
    team_b_score: 0,
    winner_team_id: winner,
    maps: [],
  }
}

const scoring = { awardPoints: false }
// Mondays: 2026-11-02, 2026-11-09, 2026-11-16.
const now = Date.parse('2026-11-18T12:00:00Z')

describe('weeklyRanks', () => {
  it('gives one point per week, replaying only matches played by then', () => {
    const matches = [
      match('2026-11-03T20:00:00Z', 'b', 'c'),
      match('2026-11-04T20:00:00Z', 'b', 'a'),
      match('2026-11-10T20:00:00Z', 'c', 'b'),
      match('2026-11-11T20:00:00Z', 'c', 'b'),
      match('2026-11-17T20:00:00Z', 'a', 'b'),
      match('2026-11-17T21:00:00Z', 'a', 'c'),
    ]
    const points = weeklyRanks('c', teams, matches, [], scoring, now)
    expect(points.map((p) => [p.week_end, p.rank, p.wins, p.losses])).toEqual([
      ['2026-11-08', 3, 0, 1],
      ['2026-11-15', 1, 2, 1],
      ['2026-11-18', 2, 2, 2],
    ])
    expect(points[0].of).toBe(3)
  })

  it('starts at the week of the team’s first series', () => {
    const matches = [
      match('2026-11-03T20:00:00Z', 'a', 'b'),
      match('2026-11-10T20:00:00Z', 'c', 'a'),
    ]
    const points = weeklyRanks('c', teams, matches, [], scoring, now)
    expect(points[0].week_end).toBe('2026-11-15')
  })

  it('applies adjustments only to the newest week', () => {
    const matches = [
      match('2026-11-03T20:00:00Z', 'a', 'c'),
      match('2026-11-10T20:00:00Z', 'b', 'c'),
    ]
    const pin = {
      team_id: 'c',
      wins: 0,
      losses: 0,
      map_wins: 0,
      map_losses: 0,
      round_diff: 0,
      points: 0,
      rank_override: 1,
    }
    const points = weeklyRanks('c', teams, matches, [pin], scoring, now)
    expect(points.at(-1)?.rank).toBe(1)
    expect(points[0].rank).toBe(3)
  })

  it('is empty for a team outside the table or a season with no results', () => {
    expect(weeklyRanks('z', teams, [], [], scoring, now)).toEqual([])
    expect(weeklyRanks('a', teams, [], [], scoring, now)).toEqual([])
  })
})
