import { describe, expect, it } from 'vitest'
import { aggregateFullSeasonRows } from './aggregate-full-season'

const base = {
  profile_id: 'p1',
  player_name: 'Player',
  games: 2,
  rounds: 40,
  kills: 30,
  deaths: 25,
  assists: 10,
  fk: 4,
  fd: 3,
  acs: 220,
}

describe('aggregateFullSeasonRows', () => {
  it('leaves stats no phase recorded null instead of summing them to zero', () => {
    const [row] = aggregateFullSeasonRows(
      [
        { ...base, clutches_won: null, clutches_attempted: null, mk_2k: null, econ_rating: null },
        { ...base, clutches_won: null, clutches_attempted: null, mk_2k: null, econ_rating: null },
      ],
      'season:s4'
    )
    expect(row!.clutches_won).toBeNull()
    expect(row!.clutches_attempted).toBeNull()
    expect(row!.mk_2k).toBeNull()
    expect(row!.econ_rating).toBeNull()
    // Plants were never recorded, so neither is the per-game rate.
    expect(row!.plants_per_game).toBeNull()
    // Recorded stats still add up.
    expect(row!.kills).toBe(60)
    expect(row!.kd).toBeCloseTo(60 / 50)
  })

  it('keeps a recorded zero as zero', () => {
    const [row] = aggregateFullSeasonRows(
      [
        { ...base, clutches_won: 0, clutches_attempted: 0 },
        { ...base, clutches_won: null, clutches_attempted: null },
      ],
      'season:s5'
    )
    expect(row!.clutches_won).toBe(0)
    expect(row!.clutches_attempted).toBe(0)
  })

  it('sums the phases that did record a stat when others did not', () => {
    const [row] = aggregateFullSeasonRows(
      [
        { ...base, clutches_won: 3, clutches_attempted: 7 },
        { ...base, clutches_won: null, clutches_attempted: null },
      ],
      'season:s5'
    )
    expect(row!.clutches_won).toBe(3)
    expect(row!.clutches_attempted).toBe(7)
  })
})
