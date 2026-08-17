import { describe, expect, it } from 'vitest'

import {
  buildPickemSlots,
  rankPickemLeaderboardEntries,
  scorePickemPayload,
  standardDoubleElim8Template,
  validatePickemPayload,
  type PickemEvent,
  type PickemPayload,
} from './pickems'

const event: Pick<PickemEvent, 'seeds'> = {
  seeds: Array.from({ length: 8 }, (_, index) => ({
    seed: index + 1,
    teamId: `team-${index + 1}`,
  })),
}

const matches = standardDoubleElim8Template()

const upperRunPayload: PickemPayload = {
  picks: {
    ub_qf_1: 'team-1',
    ub_qf_2: 'team-4',
    ub_qf_3: 'team-2',
    ub_qf_4: 'team-3',
    ub_sf_1: 'team-1',
    ub_sf_2: 'team-2',
    ub_final: 'team-1',
    lb_r1_1: 'team-8',
    lb_r1_2: 'team-7',
    lb_r2_1: 'team-4',
    lb_r2_2: 'team-3',
    lb_r3: 'team-4',
    lb_final: 'team-4',
    grand_final: 'team-1',
  },
}

describe('pickem bracket', () => {
  it('advances winners and losers through an 8-team double elimination bracket', () => {
    const slots = buildPickemSlots(event, matches, upperRunPayload)
    const byId = Object.fromEntries(slots.map((slot) => [slot.id, slot]))

    expect(byId.ub_qf_1.teamAId).toBe('team-1')
    expect(byId.ub_qf_1.teamBId).toBe('team-8')
    expect(byId.ub_sf_1.teamAId).toBe('team-1')
    expect(byId.ub_sf_1.teamBId).toBe('team-4')
    expect(byId.lb_r1_1.teamAId).toBe('team-8')
    expect(byId.lb_r1_1.teamBId).toBe('team-5')
    expect(byId.lb_r2_1.teamAId).toBe('team-4')
    expect(byId.lb_r2_1.teamBId).toBe('team-8')
    expect(byId.lb_r3.teamAId).toBe('team-4')
    expect(byId.lb_r3.teamBId).toBe('team-3')
    expect(byId.lb_final.teamAId).toBe('team-2')
    expect(byId.lb_final.teamBId).toBe('team-4')
    expect(byId.grand_final.teamAId).toBe('team-1')
    expect(byId.grand_final.teamBId).toBe('team-4')
  })

  it('uses linked real matches as the source of truth for a reconstructed bracket', () => {
    // A linked QF whose actual teams/winner diverge from the seed routing: the
    // real match was team-5 vs team-4 (not the seeded 4v5 order) and team-5 won,
    // an upset the fixed layout would otherwise drop to TBD downstream.
    const slots = buildPickemSlots(
      event,
      matches,
      { picks: {} },
      {
        ub_qf_2: { teamAId: 'team-5', teamBId: 'team-4', winnerId: 'team-5' },
        ub_sf_1: { teamAId: 'team-1', teamBId: 'team-5', winnerId: 'team-5' },
      }
    )
    const byId = Object.fromEntries(slots.map((slot) => [slot.id, slot]))

    // The linked match overrides the computed teams and winner...
    expect(byId.ub_qf_2.teamAId).toBe('team-5')
    expect(byId.ub_qf_2.teamBId).toBe('team-4')
    expect(byId.ub_qf_2.winnerId).toBe('team-5')
    // ...and the result still propagates into the next round.
    expect(byId.ub_sf_1.teamBId).toBe('team-5')
    expect(byId.ub_sf_1.winnerId).toBe('team-5')
  })

  it('rejects missing or impossible winner picks', () => {
    expect(() =>
      validatePickemPayload(event, matches, {
        picks: { ...upperRunPayload.picks, lb_final: 'team-8' },
      })
    ).toThrow('Lower Final winner must be one of the teams in that match')

    const incomplete = { ...upperRunPayload.picks }
    delete incomplete.grand_final
    expect(() => validatePickemPayload(event, matches, { picks: incomplete })).toThrow(
      'Grand Final requires a winner pick'
    )
  })

  it('scores only completed linked outcomes with configured round weights', () => {
    expect(
      scorePickemPayload(matches, upperRunPayload, {
        ub_qf_1: 'team-1',
        ub_qf_2: 'team-5',
        ub_sf_1: 'team-1',
        grand_final: 'team-1',
      })
    ).toEqual({
      score: 8,
      maxScore: 9,
      correct: ['ub_qf_1', 'ub_sf_1', 'grand_final'],
    })
  })

  it('uses shared competition ranks for tied scores', () => {
    expect(
      rankPickemLeaderboardEntries([
        { score: 5, submittedAt: '2026-01-02T00:00:00Z', user: { name: 'B' } },
        { score: 7, submittedAt: '2026-01-03T00:00:00Z', user: { name: 'A' } },
        { score: 7, submittedAt: '2026-01-01T00:00:00Z', user: { name: 'C' } },
      ]).map((row) => ({ name: row.user.name, rank: row.rank }))
    ).toEqual([
      { name: 'C', rank: 1 },
      { name: 'A', rank: 1 },
      { name: 'B', rank: 3 },
    ])
  })
})

describe('pickem weekly matchups', () => {
  const matchupEvent: Pick<PickemEvent, 'seeds'> = { seeds: [] }
  const matchupMatches = [
    {
      slotKey: 'w1_m1',
      groupKey: 'Week 1',
      label: 'Week 1 · Match 1',
      teamA: 'team-a',
      teamB: 'team-b',
      points: 1,
    },
    {
      slotKey: 'w1_m2',
      groupKey: 'Week 1',
      label: 'Week 1 · Match 2',
      teamA: 'team-c',
      teamB: 'team-d',
      points: 1,
    },
    {
      slotKey: 'w2_m1',
      groupKey: 'Week 2',
      label: 'Week 2 · Match 1',
      teamA: 'team-a',
      teamB: 'team-c',
      points: 2,
    },
  ].map((row, i) => ({
    slotKey: row.slotKey,
    groupKey: row.groupKey,
    sortOrder: i,
    label: row.label,
    points: row.points,
    teamAId: row.teamA,
    teamBId: row.teamB,
    feedA: null,
    feedB: null,
    linkedMatchId: null,
    actualWinnerId: null,
  }))

  it('resolves each unit from its assigned teams without propagation', () => {
    const slots = buildPickemSlots(matchupEvent, matchupMatches, {
      picks: { w1_m1: 'team-a', w2_m1: 'team-c' },
    })
    const byId = Object.fromEntries(slots.map((s) => [s.id, s]))
    expect(byId.w1_m1.teamAId).toBe('team-a')
    expect(byId.w1_m1.winnerId).toBe('team-a')
    expect(byId.w2_m1.winnerId).toBe('team-c')
    // An un-picked unit keeps its teams but has no winner.
    expect(byId.w1_m2.teamAId).toBe('team-c')
    expect(byId.w1_m2.winnerId).toBeNull()
  })

  it('requires a pick for every listed match', () => {
    expect(() =>
      validatePickemPayload(matchupEvent, matchupMatches, { picks: { w1_m1: 'team-a' } })
    ).toThrow('requires a winner pick')
  })

  it('weights points per match when scoring', () => {
    expect(
      scorePickemPayload(
        matchupMatches,
        { picks: { w1_m1: 'team-a', w2_m1: 'team-c' } },
        {
          w1_m1: 'team-a',
          w2_m1: 'team-a',
        }
      )
    ).toEqual({ score: 1, maxScore: 3, correct: ['w1_m1'] })
  })
})
