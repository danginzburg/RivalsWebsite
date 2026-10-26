import { describe, expect, it } from 'vitest'

import {
  bracketOpponents,
  buildPickemSlots,
  isPickemComplete,
  resolvePickemResults,
  standardDoubleElim8Template,
  type PickemEvent,
  type PickemRealMatch,
} from './pickems'

// Only the top four are seeded; each picked its opponent.
const event: Pick<PickemEvent, 'seeds'> = {
  seeds: [1, 2, 3, 4].map((seed) => ({ seed, teamId: `team-${seed}` })),
}
const matches = standardDoubleElim8Template({ 1: 'team-6', 2: 'team-8', 3: 'team-5', 4: 'team-7' })

let nextId = 0
function played(a: string, b: string, winner: string | null = a): PickemRealMatch {
  nextId += 1
  return {
    id: `m${nextId}`,
    teamAId: a,
    teamBId: b,
    winnerId: winner,
    completed: winner !== null,
  }
}

describe('top-seed opponent bracket', () => {
  it('places each picked opponent across from its seed', () => {
    const byId = Object.fromEntries(buildPickemSlots(event, matches).map((s) => [s.id, s]))
    expect([byId.ub_qf_1.teamAId, byId.ub_qf_1.teamBId]).toEqual(['team-1', 'team-6'])
    expect([byId.ub_qf_2.teamAId, byId.ub_qf_2.teamBId]).toEqual(['team-4', 'team-7'])
    expect([byId.ub_qf_3.teamAId, byId.ub_qf_3.teamBId]).toEqual(['team-2', 'team-8'])
    expect([byId.ub_qf_4.teamAId, byId.ub_qf_4.teamBId]).toEqual(['team-3', 'team-5'])
  })

  it('reads opponents back, including from an older fully seeded bracket', () => {
    expect(bracketOpponents(event, matches)).toEqual({
      1: 'team-6',
      2: 'team-8',
      3: 'team-5',
      4: 'team-7',
    })
    const eightSeeds = {
      seeds: Array.from({ length: 8 }, (_, i) => ({ seed: i + 1, teamId: `team-${i + 1}` })),
    }
    expect(bracketOpponents(eightSeeds, standardDoubleElim8Template())).toEqual({
      1: 'team-8',
      2: 'team-7',
      3: 'team-6',
      4: 'team-5',
    })
  })
})

describe('resolvePickemResults', () => {
  it('detects every result from the matches between each slot’s teams', () => {
    // Played in order: QFs, upper SFs, lower R1, lower R2, upper final, lower
    // R3, lower final, grand final — a rematch of the upper final.
    const candidates = [
      played('team-1', 'team-6'),
      played('team-7', 'team-4', 'team-4'),
      played('team-2', 'team-8'),
      played('team-3', 'team-5', 'team-5'),
      played('team-1', 'team-4'),
      played('team-2', 'team-5'),
      played('team-6', 'team-7'),
      played('team-8', 'team-3'),
      played('team-4', 'team-6'),
      played('team-5', 'team-8'),
      played('team-1', 'team-2'),
      played('team-4', 'team-5'),
      played('team-2', 'team-4', 'team-4'),
      played('team-1', 'team-4', 'team-4'),
    ]
    const { actualWinners, sourceMatchIds } = resolvePickemResults(event, matches, {
      linked: {},
      candidates,
    })

    expect(actualWinners).toMatchObject({
      ub_qf_2: 'team-4',
      ub_qf_4: 'team-5',
      ub_final: 'team-1',
      lb_final: 'team-4',
      grand_final: 'team-4',
    })
    // The upper final and grand final are the same pairing; each gets its own game.
    expect(sourceMatchIds.ub_sf_1).toBe(candidates[4]!.id)
    expect(sourceMatchIds.grand_final).toBe(candidates[13]!.id)
    expect(isPickemComplete(matches, actualWinners)).toBe(true)
  })

  it('shows teams for an unplayed match but scores nothing until it finishes', () => {
    const { linkedResults, actualWinners } = resolvePickemResults(event, matches, {
      linked: {},
      candidates: [played('team-6', 'team-1', null)],
    })
    expect(linkedResults.ub_qf_1).toEqual({ teamAId: 'team-1', teamBId: 'team-6', winnerId: null })
    expect(actualWinners).toEqual({})
    expect(isPickemComplete(matches, actualWinners)).toBe(false)
  })

  it('prefers a manually linked match and never reuses it', () => {
    const pinned = played('team-1', 'team-6', 'team-6')
    const linkedMatches = matches.map((m) =>
      m.slotKey === 'ub_qf_1' ? { ...m, linkedMatchId: pinned.id } : m
    )
    const { actualWinners } = resolvePickemResults(event, linkedMatches, {
      linked: { [pinned.id]: pinned },
      candidates: [pinned, played('team-1', 'team-6')],
    })
    expect(actualWinners.ub_qf_1).toBe('team-6')
  })
})
