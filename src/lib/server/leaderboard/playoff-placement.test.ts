import { describe, expect, it } from 'vitest'
import { buildPickemSlots, standardDoubleElim8Template } from '$lib/pickems'
import { bracketPlacement, describePlacement, placementAt } from './playoff-placement'

const event = { seeds: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ seed: n, teamId: `t${n}` })) }
const matches = standardDoubleElim8Template()

/** Slots with the given winners, keyed by slot. */
function slotsWith(winners: Record<string, string>) {
  return buildPickemSlots(event, matches, { picks: winners })
}

// Upper QFs to the top seeds, t7 then wins its way through the lower bracket.
const throughLowerSemi = {
  ub_qf_1: 't1',
  ub_qf_2: 't4',
  ub_qf_3: 't2',
  ub_qf_4: 't3',
  ub_sf_1: 't1',
  ub_sf_2: 't2',
  lb_r1_1: 't8',
  lb_r1_2: 't7',
  lb_r2_1: 't3',
  lb_r2_2: 't7',
  lb_r3: 't7',
}

describe('bracketPlacement', () => {
  it('locks top 3 for a team that has reached the lower final', () => {
    const p = bracketPlacement(matches, slotsWith(throughLowerSemi), 't7')
    expect(p).toEqual({ best: 1, worstStart: 3, worstEnd: 3, decided: false })
    expect(describePlacement(p!)).toBe('Top 3 locked')
  })

  it('gives eliminated teams their finishing range', () => {
    const slots = slotsWith(throughLowerSemi)
    // Lost the lower round 3: 4th.
    expect(bracketPlacement(matches, slots, 't3')).toMatchObject({ worstStart: 4, decided: true })
    // Lower R2 losers share 5th–6th, lower R1 losers 7th–8th.
    expect(bracketPlacement(matches, slots, 't8')).toMatchObject({ worstStart: 5, worstEnd: 6 })
    expect(bracketPlacement(matches, slots, 't5')).toMatchObject({ worstStart: 7, worstEnd: 8 })
    expect(describePlacement(bracketPlacement(matches, slots, 't5')!)).toBe('Finished 7th–8th')
  })

  it('reads a team waiting in the upper final as in the top 3 with a shot at 1st', () => {
    const p = bracketPlacement(matches, slotsWith(throughLowerSemi), 't1')
    expect(p).toEqual({ best: 1, worstStart: 3, worstEnd: 3, decided: false })
  })

  it('gives a team still in the upper quarters the worst case of losing out', () => {
    const p = bracketPlacement(matches, slotsWith({}), 't6')
    expect(p).toEqual({ best: 1, worstStart: 7, worstEnd: 8, decided: false })
  })

  it('settles the final', () => {
    const slots = slotsWith({
      ...throughLowerSemi,
      ub_final: 't1',
      lb_final: 't7',
      grand_final: 't7',
    })
    expect(describePlacement(bracketPlacement(matches, slots, 't7')!)).toBe('Champions')
    expect(describePlacement(bracketPlacement(matches, slots, 't1')!)).toBe('Finished 2nd')
    expect(describePlacement(bracketPlacement(matches, slots, 't2')!)).toBe('Finished 3rd')
  })

  it('is null for a team not in the bracket', () => {
    expect(bracketPlacement(matches, slotsWith({}), 'nobody')).toBeNull()
  })
})

describe('placementAt', () => {
  it('ignores results played after the cutoff', () => {
    const linkedResults = { ub_qf_3: { teamAId: 't2', teamBId: 't7', winnerId: 't2' } }
    const bracket = { event, matches, linkedResults, playedAt: { ub_qf_3: 1000 } }
    expect(placementAt(bracket, 't7', 500, false)?.worstStart).toBe(7)
    // After the loss t7 drops to the lower bracket: still 7th–8th at worst.
    expect(placementAt(bracket, 't7', 2000, false)).toMatchObject({ worstEnd: 8, decided: false })
    expect(placementAt(bracket, 't2', 2000, false)?.worstStart).toBe(5)
  })
})
