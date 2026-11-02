import { describe, expect, it } from 'vitest'

import { formatRecordValue, isRecordSeasonCode } from '$lib/records/categories'
import { computeStatRecords, type MapResult, type PlayerPerformance } from './compute'
import { recordEntryKey } from './overrides'

let nextId = 1

function perf(
  overrides: Partial<PlayerPerformance> & { stats?: Record<string, number | null> }
): PlayerPerformance {
  const id = nextId++
  return {
    matchId: `match-${id}`,
    matchMapId: `map-${id}`,
    mapOrder: 1,
    mapName: 'Ascent',
    seasonId: 's5',
    stage: 'regular',
    scheduledAt: '2026-12-01T00:00:00Z',
    statId: id,
    profileId: `p-${id}`,
    playerName: `Player ${id}`,
    puuid: null,
    teamId: 'team-a',
    opponentTeamId: 'team-b',
    agents: 'Jett',
    rounds: 24,
    roundsWon: 13,
    roundsLost: 11,
    duels: null,
    ...overrides,
    stats: { kills: 15, deaths: 15, kd: 1, ...overrides.stats },
  }
}

type Rows = ReturnType<typeof computeStatRecords>

function current(rows: Rows, category: string) {
  return rows.find((r) => r.category === category && r.rank === 1)
}

function ranked(rows: Rows, category: string) {
  return rows
    .filter((r) => r.category === category && r.rank !== null)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
}

describe('computeStatRecords', () => {
  it('ranks the top performances, best first', () => {
    const rows = computeStatRecords(
      [
        perf({ scheduledAt: '2026-12-01T00:00:00Z', stats: { kills: 20 } }),
        perf({ scheduledAt: '2026-12-08T00:00:00Z', stats: { kills: 18 } }),
        perf({ scheduledAt: '2026-12-15T00:00:00Z', stats: { kills: 31 }, profileId: 'star' }),
      ],
      []
    )
    expect(ranked(rows, 'kills').map((r) => r.value)).toEqual([31, 20, 18])
    expect(current(rows, 'kills')?.profile_id).toBe('star')
    expect(rows.filter((r) => r.category === 'kills')).toHaveLength(3)
  })

  it('keeps only the top 5', () => {
    const rows = computeStatRecords(
      [10, 30, 20, 50, 40, 60, 5].map((kills) => perf({ stats: { kills } })),
      []
    )
    expect(ranked(rows, 'kills').map((r) => r.value)).toEqual([60, 50, 40, 30, 20])
  })

  it('moves the next performance up when one is hidden', () => {
    const best = perf({ stats: { kills: 50 } })
    const rows = computeStatRecords(
      [best, perf({ stats: { kills: 40 } })],
      [],
      new Set([`kills|${recordEntryKey(best.matchMapId, best.statId)}`])
    )
    expect(ranked(rows, 'kills').map((r) => r.value)).toEqual([40])
    // Hidden from kills only — it still counts everywhere else.
    expect(ranked(rows, 'deaths')).toHaveLength(2)
  })

  it('leaves the record with whoever reached it first and counts later equals as ties', () => {
    const rows = computeStatRecords(
      [
        perf({ scheduledAt: '2026-12-08T00:00:00Z', stats: { kills: 30 }, profileId: 'second' }),
        perf({ scheduledAt: '2026-12-01T00:00:00Z', stats: { kills: 30 }, profileId: 'first' }),
      ],
      []
    )
    expect(ranked(rows, 'kills').map((r) => r.profile_id)).toEqual(['first', 'second'])
  })

  it('counts the ties cut off the bottom of the list', () => {
    const rows = computeStatRecords(
      [9, 5, 1, 1, 1, 1, 1, 1].map((n) => perf({ stats: { mk_5k: n } })),
      []
    )
    const top = ranked(rows, 'mk_5k')
    expect(top.map((r) => r.value)).toEqual([9, 5, 1, 1, 1])
    // Six performances on 1, three of them listed.
    expect(top.at(-1)?.tie_count).toBe(3)
    // The three cut off are named, so a signed-in one can be told.
    expect((top.at(-1)?.context.tied_off_profile_ids as string[]).length).toBe(3)
    expect(top.slice(0, -1).every((r) => r.tie_count === 0)).toBe(true)
  })

  it('counts no cut-off ties when everyone level made the list', () => {
    const rows = computeStatRecords([perf({ stats: { kills: 30 } })], [])
    expect(current(rows, 'kills')?.tie_count).toBe(0)
  })

  it('judges ties at display precision', () => {
    const rows = computeStatRecords(
      [
        perf({ scheduledAt: '2026-12-01T00:00:00Z', stats: { kd: 2.501 } }),
        perf({ scheduledAt: '2026-12-08T00:00:00Z', stats: { kd: 2.499 } }),
      ],
      []
    )
    expect(ranked(rows, 'kd').map((r) => r.value)).toEqual([2.5, 2.5])
  })

  it('skips stats the source never recorded rather than reading them as zero', () => {
    const rows = computeStatRecords([perf({ stats: { mk_5k: null } })], [])
    expect(current(rows, 'mk_5k')).toBeUndefined()
  })

  it('ignores an impossible row (more deaths than rounds) instead of crowning it', () => {
    const rows = computeStatRecords(
      [perf({ stats: { deaths: 18 } }), perf({ rounds: 24, stats: { deaths: 131, kd: 0.05 } })],
      []
    )
    expect(current(rows, 'deaths')?.value).toBe(18)
    expect(current(rows, 'kd')?.value).toBe(1)
  })

  it('works out differentials from two columns', () => {
    const rows = computeStatRecords([perf({ stats: { kills: 30, deaths: 12, fk: 7, fd: 2 } })], [])
    expect(current(rows, 'kd_diff')?.value).toBe(18)
    expect(current(rows, 'fk_fd_diff')?.value).toBe(5)
  })

  it('finds the most one-sided duel for each player, netting kills both ways', () => {
    const map = { matchId: 'm', matchMapId: 'map-duel' }
    const rows = computeStatRecords(
      [
        perf({ ...map, puuid: 'a', playerName: 'A', duels: { b: 9, c: 3 } }),
        perf({ ...map, puuid: 'b', playerName: 'B', duels: { a: 2 } }),
        perf({ ...map, puuid: 'c', playerName: 'C', duels: { a: 3 } }),
      ],
      []
    )
    const top = ranked(rows, 'duel_diff')
    // A is +7 on B; A vs C is level, and B and C were out-killed — no other entries.
    expect(top.map((r) => [r.player_name, r.value])).toEqual([['A', 7]])
    expect(top[0].context).toMatchObject({
      duel_opponent_name: 'B',
      duel_kills_for: 9,
      duel_kills_against: 2,
    })
  })

  it('leaves maps with no kill feed out of the duel record', () => {
    const rows = computeStatRecords([perf({ puuid: 'a', stats: { kills: 30 } })], [])
    expect(ranked(rows, 'duel_diff')).toHaveLength(0)
  })

  it('counts kills in a loss only on maps the player lost', () => {
    const rows = computeStatRecords(
      [
        perf({ roundsWon: 13, roundsLost: 8, stats: { kills: 35 } }),
        perf({ roundsWon: 11, roundsLost: 13, stats: { kills: 28 }, profileId: 'unlucky' }),
      ],
      []
    )
    expect(ranked(rows, 'kills_in_loss').map((r) => r.value)).toEqual([28])
    expect(current(rows, 'kills_in_loss')?.profile_id).toBe('unlucky')
  })

  it('never records a low: a worse performance later does not move the #1', () => {
    const rows = computeStatRecords(
      [
        perf({ scheduledAt: '2026-12-01T00:00:00Z', stats: { kills: 20 } }),
        perf({ scheduledAt: '2026-12-08T00:00:00Z', stats: { kills: 2 } }),
      ],
      []
    )
    expect(current(rows, 'kills')?.value).toBe(20)
  })

  it('credits team records to the map winner', () => {
    const map: MapResult = {
      matchId: 'm1',
      matchMapId: 'mm1',
      mapOrder: 2,
      mapName: 'Bind',
      seasonId: 's5',
      stage: 'playoffs',
      scheduledAt: '2026-12-01T00:00:00Z',
      teamAId: 'loser',
      teamBId: 'winner',
      teamARounds: 2,
      teamBRounds: 13,
    }
    const rows = computeStatRecords([], [map])
    const margin = current(rows, 'map_margin')
    expect(margin?.value).toBe(11)
    expect(margin?.team_id).toBe('winner')
    expect(margin?.opponent_team_id).toBe('loser')
    expect(current(rows, 'map_rounds')?.value).toBe(15)
  })
})

describe('isRecordSeasonCode', () => {
  it('counts Rivals 5 onward and nothing else', () => {
    expect(isRecordSeasonCode('rivals4')).toBe(false)
    expect(isRecordSeasonCode('rivals5')).toBe(true)
    expect(isRecordSeasonCode('rivals12')).toBe(true)
    expect(isRecordSeasonCode('shitq1')).toBe(false)
  })
})

describe('formatRecordValue', () => {
  it('signs a positive differential and leaves other stats alone', () => {
    expect(formatRecordValue('kd_diff', 18)).toBe('+18')
    expect(formatRecordValue('kd_diff', 0)).toBe('0')
    expect(formatRecordValue('kills', 18)).toBe('18')
  })
})
