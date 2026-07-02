import { describe, expect, it } from 'vitest'

import {
  buildPlayoffBracketSlots,
  rankPlayoffLeaderboardEntries,
  scorePlayoffPickemPayload,
  validatePlayoffPickemPayload,
  type PlayoffPickemConfig,
  type PlayoffPickemPayload,
} from './playoffPickems'

const config: PlayoffPickemConfig = {
  enabled: true,
  status: 'open',
  lock_at: null,
  seeds: Array.from({ length: 8 }, (_, index) => ({
    seed: index + 1,
    teamId: `team-${index + 1}`,
  })),
  match_links: [],
}

const upperRunPayload: PlayoffPickemPayload = {
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

describe('playoff pickem bracket', () => {
  it('advances winners and losers through an 8-team double elimination bracket', () => {
    const slots = buildPlayoffBracketSlots(config, upperRunPayload)
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

  it('rejects missing or impossible winner picks', () => {
    expect(() =>
      validatePlayoffPickemPayload(config, {
        picks: { ...upperRunPayload.picks, lb_final: 'team-8' },
      })
    ).toThrow('Lower Final winner must be one of the teams in that match')

    const incomplete = { ...upperRunPayload.picks }
    delete incomplete.grand_final
    expect(() => validatePlayoffPickemPayload(config, { picks: incomplete })).toThrow(
      'Grand Final requires a winner pick'
    )
  })

  it('scores only completed linked outcomes with configured round weights', () => {
    expect(
      scorePlayoffPickemPayload(upperRunPayload, {
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
      rankPlayoffLeaderboardEntries([
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
