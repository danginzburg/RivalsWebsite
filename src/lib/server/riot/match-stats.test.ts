import { describe, expect, it } from 'vitest'
import {
  derivePlayerStats,
  TRADE_WINDOW_MS,
  type RiotKillEvent,
  type RiotMatch,
  type RiotPlayer,
  type RiotRound,
} from './match-stats'

/** Five-a-side rosters with predictable puuids: red0..red4 / blue0..blue4. */
function players(): RiotPlayer[] {
  const make = (team: string, i: number): RiotPlayer => ({
    puuid: `${team}${i}`,
    name: `${team}${i}`,
    tag: 'NA1',
    team_id: team === 'red' ? 'Red' : 'Blue',
    agent: { name: 'Jett' },
    stats: {
      score: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      headshots: 0,
      bodyshots: 0,
      legshots: 0,
      damage: { dealt: 0, received: 0 },
    },
  })
  return [0, 1, 2, 3, 4].flatMap((i) => [make('red', i), make('blue', i)])
}

function kill(
  round: number,
  timeMs: number,
  killer: string,
  victim: string,
  assistants: string[] = []
): RiotKillEvent {
  const team = (p: string) => (p.startsWith('red') ? 'Red' : 'Blue')
  return {
    round,
    time_in_round_in_ms: timeMs,
    killer: { puuid: killer, team: team(killer) },
    victim: { puuid: victim, team: team(victim) },
    assistants: assistants.map((puuid) => ({ puuid })),
  }
}

function match(rounds: RiotRound[], kills: RiotKillEvent[], roster = players()): RiotMatch {
  return { players: roster, rounds, kills }
}

const statsFor = (result: ReturnType<typeof derivePlayerStats>, puuid: string) =>
  result.find((r) => r.puuid === puuid)!

describe('multikills', () => {
  it('counts a round by how many kills one player got in it', () => {
    const result = derivePlayerStats(
      match(
        [{ winning_team: 'Red' }, { winning_team: 'Red' }],
        [
          // Round 0: red0 gets three.
          kill(0, 1000, 'red0', 'blue0'),
          kill(0, 2000, 'red0', 'blue1'),
          kill(0, 3000, 'red0', 'blue2'),
          // Round 1: red0 gets two, red1 gets one (not a multikill).
          kill(1, 1000, 'red0', 'blue0'),
          kill(1, 2000, 'red0', 'blue1'),
          kill(1, 3000, 'red1', 'blue2'),
        ]
      )
    )

    expect(statsFor(result, 'red0').multiKills).toEqual({ k2: 1, k3: 1, k4: 0, k5: 0 })
    expect(statsFor(result, 'red1').multiKills).toEqual({ k2: 0, k3: 0, k4: 0, k5: 0 })
  })

  it('records an ace as a 5k', () => {
    const result = derivePlayerStats(
      match(
        [{ winning_team: 'Red' }],
        [0, 1, 2, 3, 4].map((i) => kill(0, 1000 * (i + 1), 'red0', `blue${i}`))
      )
    )

    expect(statsFor(result, 'red0').multiKills.k5).toBe(1)
  })

  it('ignores a self-inflicted death, which the API records as killer = victim', () => {
    const result = derivePlayerStats(
      match(
        [{ winning_team: 'Blue' }],
        [kill(0, 1000, 'red0', 'blue0'), kill(0, 2000, 'red0', 'red0')]
      )
    )

    // One real kill plus a suicide is not a 2k.
    expect(statsFor(result, 'red0').multiKills.k2).toBe(0)
  })
})

describe('clutches', () => {
  it('sizes a clutch by how many opponents were alive when it started', () => {
    // Blue wipes four reds, leaving red4 alone against three blues, and red4 wins.
    const result = derivePlayerStats(
      match(
        [{ winning_team: 'Red' }],
        [
          kill(0, 1000, 'blue0', 'red0'),
          kill(0, 2000, 'blue0', 'red1'),
          kill(0, 3000, 'red4', 'blue1'),
          kill(0, 4000, 'blue0', 'red2'),
          kill(0, 5000, 'blue0', 'red3'), // red down to red4; blue has 0,2,3,4 → 4 alive
          kill(0, 6000, 'red4', 'blue0'),
          kill(0, 7000, 'red4', 'blue2'),
          kill(0, 8000, 'red4', 'blue3'),
          kill(0, 9000, 'red4', 'blue4'),
        ]
      )
    )

    const red4 = statsFor(result, 'red4')
    expect(red4.clutches.attempted).toBe(1)
    expect(red4.clutches.won[4]).toBe(1)
    expect(red4.clutches.totalWon).toBe(1)
  })

  it('counts a lost clutch as attempted but not won', () => {
    const result = derivePlayerStats(
      match(
        [{ winning_team: 'Blue' }],
        [
          kill(0, 1000, 'blue0', 'red0'),
          kill(0, 2000, 'blue0', 'red1'),
          kill(0, 3000, 'blue0', 'red2'),
          kill(0, 4000, 'blue0', 'red3'), // red4 alone vs 5
          kill(0, 5000, 'blue0', 'red4'),
        ]
      )
    )

    const red4 = statsFor(result, 'red4')
    expect(red4.clutches.attempted).toBe(1)
    expect(red4.clutches.totalWon).toBe(0)
    expect(red4.clutches.won[5]).toBe(0)
  })

  it('does not call it a clutch when the last opponent is already dead', () => {
    // Red wins 5v0 — nobody is ever the last player alive against opposition.
    const result = derivePlayerStats(
      match(
        [{ winning_team: 'Red' }],
        [0, 1, 2, 3, 4].map((i) => kill(0, 1000 * (i + 1), `red${i}`, `blue${i}`))
      )
    )

    // Blue's last man dies at the same moment blue drops to one, so blue0..3
    // never enter a clutch; check nobody on red did either.
    for (const i of [0, 1, 2, 3, 4]) {
      expect(statsFor(result, `red${i}`).clutches.attempted).toBe(0)
    }
  })
})

describe('KAST', () => {
  it('credits a survivor who did nothing', () => {
    // Round 0: only red0 and blue0 trade blows; everyone else survives.
    const result = derivePlayerStats(
      match([{ winning_team: 'Red' }], [kill(0, 1000, 'red0', 'blue0')])
    )

    expect(statsFor(result, 'red3').kastPct).toBe(100)
    // blue0 died, was not traded, got no kill or assist.
    expect(statsFor(result, 'blue0').kastPct).toBe(0)
  })

  it('credits a traded death inside the window but not outside it', () => {
    const inside = derivePlayerStats(
      match(
        [{ winning_team: 'Red' }],
        [kill(0, 1000, 'blue0', 'red0'), kill(0, 1000 + TRADE_WINDOW_MS - 1, 'red1', 'blue0')]
      )
    )
    expect(statsFor(inside, 'red0').kastPct).toBe(100)

    const outside = derivePlayerStats(
      match(
        [{ winning_team: 'Red' }],
        [kill(0, 1000, 'blue0', 'red0'), kill(0, 1000 + TRADE_WINDOW_MS + 1, 'red1', 'blue0')]
      )
    )
    expect(statsFor(outside, 'red0').kastPct).toBe(0)
  })

  it('credits an assist', () => {
    const result = derivePlayerStats(
      match([{ winning_team: 'Red' }], [kill(0, 1000, 'blue0', 'red0', ['red1'])])
    )
    expect(statsFor(result, 'red1').kastPct).toBe(100)
  })
})

describe('opening duels', () => {
  it('attributes the first kill of each round only', () => {
    const result = derivePlayerStats(
      match(
        [{ winning_team: 'Red' }, { winning_team: 'Blue' }],
        [
          kill(0, 1000, 'red0', 'blue0'),
          kill(0, 2000, 'red1', 'blue1'),
          kill(1, 500, 'blue2', 'red2'),
        ]
      )
    )

    expect(statsFor(result, 'red0').firstKills).toBe(1)
    expect(statsFor(result, 'red1').firstKills).toBe(0)
    expect(statsFor(result, 'blue0').firstDeaths).toBe(1)
    expect(statsFor(result, 'blue2').firstKills).toBe(1)
    expect(statsFor(result, 'red2').firstDeaths).toBe(1)
  })

  it('orders by time, not by array position', () => {
    const result = derivePlayerStats(
      match(
        [{ winning_team: 'Red' }],
        [kill(0, 9000, 'red0', 'blue0'), kill(0, 1000, 'red1', 'blue1')]
      )
    )

    expect(statsFor(result, 'red1').firstKills).toBe(1)
    expect(statsFor(result, 'red0').firstKills).toBe(0)
  })
})

describe('rate stats', () => {
  it('divides score and damage by rounds, and reads shots for HS%', () => {
    const roster = players()
    roster[0].stats = {
      score: 6000,
      kills: 20,
      deaths: 10,
      assists: 5,
      headshots: 30,
      bodyshots: 60,
      legshots: 10,
      damage: { dealt: 3000, received: 2000 },
    }

    const rounds: RiotRound[] = Array.from({ length: 20 }, () => ({
      winning_team: 'Red',
      stats: [{ player: { puuid: 'red0' }, economy: { loadout_value: 3000 } }],
    }))

    const result = derivePlayerStats(match(rounds, [], roster))
    const red0 = statsFor(result, 'red0')

    expect(red0.acs).toBe(300) // 6000 / 20
    expect(red0.adr).toBe(150) // 3000 / 20
    expect(red0.kd).toBe(2) // 20 / 10
    expect(red0.hsPct).toBe(30) // 30 of 100 shots
    expect(red0.econRating).toBe(50) // 3000 damage per 60000 credits, x1000
  })

  it('reports K/D as the kill count when a player never died', () => {
    const roster = players()
    roster[0].stats = { ...roster[0].stats, kills: 7, deaths: 0 }
    const result = derivePlayerStats(match([{ winning_team: 'Red' }], [], roster))
    expect(statsFor(result, 'red0').kd).toBe(7)
  })

  it('does not divide by zero on an empty match', () => {
    const result = derivePlayerStats(match([], []))
    expect(statsFor(result, 'red0').acs).toBe(0)
    expect(statsFor(result, 'red0').adr).toBe(0)
    expect(statsFor(result, 'red0').kastPct).toBe(0)
  })
})

describe('head-to-head duels', () => {
  it('counts kills per opponent, one direction only', () => {
    const result = derivePlayerStats(
      match(
        [{ winning_team: 'Red' }, { winning_team: 'Blue' }],
        [
          kill(0, 1000, 'red0', 'blue0'),
          kill(0, 2000, 'red0', 'blue0'), // same duel again next round
          kill(0, 3000, 'red0', 'blue1'),
          kill(1, 1000, 'blue0', 'red0'),
        ]
      )
    )

    expect(statsFor(result, 'red0').duels).toEqual({ blue0: 2, blue1: 1 })
    // The reverse direction lives on the other player, not mirrored here.
    expect(statsFor(result, 'blue0').duels).toEqual({ red0: 1 })
    expect(statsFor(result, 'blue1').duels).toEqual({})
  })

  it('excludes team kills, which are mis-clicks rather than duels', () => {
    const result = derivePlayerStats(
      match(
        [{ winning_team: 'Red' }],
        [kill(0, 1000, 'red0', 'red1'), kill(0, 2000, 'red0', 'blue0')]
      )
    )

    expect(statsFor(result, 'red0').duels).toEqual({ blue0: 1 })
  })

  it('transposes into the deaths side of the grid', () => {
    const result = derivePlayerStats(
      match(
        [{ winning_team: 'Red' }],
        [kill(0, 1000, 'red0', 'blue0'), kill(0, 2000, 'blue1', 'red0')]
      )
    )

    // What the UI does to fill the square: red0's deaths to blue1 are read off
    // blue1's own duel row.
    const deathsOfRed0ToBlue1 = statsFor(result, 'blue1').duels['red0']
    expect(deathsOfRed0ToBlue1).toBe(1)
  })
})

describe('spike actions', () => {
  it('counts plants and defuses', () => {
    const result = derivePlayerStats(
      match(
        [
          { winning_team: 'Red', plant: { player: { puuid: 'red0' } } },
          {
            winning_team: 'Blue',
            plant: { player: { puuid: 'red0' } },
            defuse: { player: { puuid: 'blue1' } },
          },
        ],
        []
      )
    )

    expect(statsFor(result, 'red0').plants).toBe(2)
    expect(statsFor(result, 'blue1').defuses).toBe(1)
  })
})
