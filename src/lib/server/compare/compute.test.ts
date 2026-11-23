import { describe, expect, it } from 'vitest'
import {
  aggregateRows,
  comparePlayers,
  normalizeRosterDates,
  scopeGraph,
  compareTeams,
  pairsOf,
  type GraphMapRow,
  type MatchGraph,
} from './compute'

function row(
  partial: Partial<GraphMapRow> & Pick<GraphMapRow, 'match_map_id' | 'match_id'>
): GraphMapRow {
  return {
    team_id: null,
    profile_id: null,
    rounds: 20,
    acs: 200,
    kills: 15,
    deaths: 15,
    assists: 5,
    adr: 130,
    kast_pct: 70,
    hs_pct: 25,
    fk: 2,
    fd: 2,
    ...partial,
  }
}

// T1 beat T2 2-1 (m1), T2 beat T3 2-0 (m2), T1 beat T3 2-0 (m3, no map stats).
const graph: MatchGraph = {
  matches: [
    {
      id: 'm1',
      season_id: 's',
      team_a_id: 'T1',
      team_b_id: 'T2',
      winner_team_id: 'T1',
      team_a_score: 2,
      team_b_score: 1,
      scheduled_at: '2026-05-01',
      stage: 'regular',
    },
    {
      id: 'm2',
      season_id: 's',
      team_a_id: 'T3',
      team_b_id: 'T2',
      winner_team_id: 'T2',
      team_a_score: 0,
      team_b_score: 2,
      scheduled_at: '2026-05-08',
      stage: 'regular',
    },
    {
      id: 'm3',
      season_id: 's',
      team_a_id: 'T1',
      team_b_id: 'T3',
      winner_team_id: 'T1',
      team_a_score: 2,
      team_b_score: 0,
      scheduled_at: '2026-05-15',
      stage: 'playoffs',
    },
  ],
  maps: [
    { id: 'm1-1', match_id: 'm1', map_name: 'Ascent', team_a_rounds: 13, team_b_rounds: 9 },
    { id: 'm1-2', match_id: 'm1', map_name: 'Bind', team_a_rounds: 10, team_b_rounds: 13 },
    { id: 'm1-3', match_id: 'm1', map_name: 'Ascent', team_a_rounds: 13, team_b_rounds: 11 },
    { id: 'm2-1', match_id: 'm2', map_name: 'Lotus', team_a_rounds: 5, team_b_rounds: 13 },
    { id: 'm2-2', match_id: 'm2', map_name: 'Bind', team_a_rounds: 11, team_b_rounds: 13 },
  ],
  rows: [
    // Alice on T1, Bob on T2 in m1; Bob and Carol both on T2 in m2.
    row({
      match_map_id: 'm1-1',
      match_id: 'm1',
      team_id: 'T1',
      profile_id: 'alice',
      acs: 300,
      kills: 20,
      deaths: 10,
    }),
    row({
      match_map_id: 'm1-1',
      match_id: 'm1',
      team_id: 'T2',
      profile_id: 'bob',
      acs: 150,
      kills: 10,
      deaths: 20,
    }),
    row({ match_map_id: 'm1-2', match_id: 'm1', team_id: 'T1', profile_id: 'alice' }),
    row({ match_map_id: 'm1-2', match_id: 'm1', team_id: 'T2', profile_id: 'bob' }),
    row({ match_map_id: 'm2-1', match_id: 'm2', team_id: 'T2', profile_id: 'bob' }),
    row({ match_map_id: 'm2-1', match_id: 'm2', team_id: 'T2', profile_id: 'carol' }),
    row({ match_map_id: 'm2-2', match_id: 'm2', team_id: 'T2', profile_id: 'bob' }),
    row({ match_map_id: 'm2-2', match_id: 'm2', team_id: 'T2', profile_id: 'carol' }),
  ],
  // m3 (T1 beat T3 2-0) has no per-map stats, so rosters decide it: Alice on
  // T1; Dave on T3 until he left before m3; Erin on T3 the whole time.
  rosters: [
    { team_id: 'T1', profile_id: 'alice', joined_at: null, left_at: null },
    { team_id: 'T3', profile_id: 'dave', joined_at: null, left_at: '2026-05-10' },
    { team_id: 'T3', profile_id: 'erin', joined_at: null, left_at: null },
    { team_id: 'T1', profile_id: 'frank', joined_at: null, left_at: null },
    // Bob is on T2's roster, but m1 and m2 have map stats, which win over rosters.
    { team_id: 'T2', profile_id: 'bob', joined_at: null, left_at: null },
  ],
}

describe('pairsOf', () => {
  it('lists every unordered pair once, in order', () => {
    expect(pairsOf(['a', 'b', 'c'])).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ])
  })
})

describe('aggregateRows', () => {
  it('weights rates by rounds and derives K/D from totals', () => {
    const agg = aggregateRows([
      row({ match_map_id: 'x', match_id: 'm', rounds: 10, acs: 300, kills: 10, deaths: 5 }),
      row({ match_map_id: 'y', match_id: 'm', rounds: 30, acs: 100, kills: 10, deaths: 15 }),
    ])!
    expect(agg.acs).toBe(150)
    expect(agg.kd).toBe(1)
    expect(agg.maps).toBe(2)
  })

  it('returns null for no rows', () => {
    expect(aggregateRows([])).toBeNull()
  })
})

describe('compareTeams', () => {
  const { summaries, pairs } = compareTeams(['T1', 'T2', 'T3'], graph)

  it('counts series, maps, rounds and the map pool per team', () => {
    const t2 = summaries.find((s) => s.teamId === 'T2')!
    expect(t2.series).toEqual({ won: 1, lost: 1 })
    expect(t2.maps).toEqual({ won: 3, lost: 2 })
    expect(t2.roundsWon).toBe(9 + 13 + 11 + 13 + 13)
    expect(t2.mapPool).toEqual([
      { map: 'Ascent', played: 2, won: 0 },
      { map: 'Bind', played: 2, won: 2 },
      { map: 'Lotus', played: 1, won: 1 },
    ])
  })

  it('counts a forfeit-style series with no maps in the series record only', () => {
    const t3 = summaries.find((s) => s.teamId === 'T3')!
    expect(t3.series).toEqual({ won: 0, lost: 2 })
    expect(t3.maps).toEqual({ won: 0, lost: 2 })
    expect(t3.stats).toBeNull()
  })

  it('builds head-to-head records from the first team of each pair', () => {
    const t1t2 = pairs.find((p) => p.a === 'T1' && p.b === 'T2')!
    expect(t1t2.series).toEqual({ won: 1, lost: 0 })
    expect(t1t2.maps).toEqual({ won: 2, lost: 1 })
    expect(t1t2.meetings).toHaveLength(1)

    const t2t3 = pairs.find((p) => p.a === 'T2' && p.b === 'T3')!
    expect(t2t3.series).toEqual({ won: 1, lost: 0 })
    expect(t2t3.meetings[0]).toMatchObject({ scoreA: 2, scoreB: 0 })
  })
})

describe('comparePlayers', () => {
  const { pairs } = comparePlayers(['alice', 'bob', 'carol'], graph)

  it('records maps played against each other from the first player’s side', () => {
    const ab = pairs.find((p) => p.a === 'alice' && p.b === 'bob')!
    expect(ab.against).toEqual({ maps: 2, won: 1, lost: 1 })
    expect(ab.againstSeries).toEqual({ won: 1, lost: 0 })
    expect(ab.together.maps).toBe(0)
    expect(ab.statsA!.kd).toBeCloseTo(35 / 25)
    expect(ab.meetings.map((m) => m.matchId)).toEqual(['m1'])
  })

  it('records maps played as teammates', () => {
    const bc = pairs.find((p) => p.a === 'bob' && p.b === 'carol')!
    expect(bc.together).toEqual({ maps: 2, won: 2, lost: 0 })
    expect(bc.against.maps).toBe(0)
    expect(bc.meetings).toEqual([])
  })

  it('leaves pairs who never shared a map empty', () => {
    const ac = pairs.find((p) => p.a === 'alice' && p.b === 'carol')!
    expect(ac.against.maps + ac.together.maps).toBe(0)
    expect(ac.statsA).toBeNull()
  })
})

describe('scopeGraph', () => {
  it('keeps everything with no scope', () => {
    expect(scopeGraph(graph, {})).toBe(graph)
  })

  it('narrows matches, maps and rows to a stage', () => {
    const regular = scopeGraph(graph, { stage: 'regular' })
    expect(regular.matches.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(regular.maps).toHaveLength(5)
    const playoffs = scopeGraph(graph, { stage: 'playoffs' })
    expect(playoffs.matches.map((m) => m.id)).toEqual(['m3'])
    expect(playoffs.rows).toEqual([])
    expect(comparePlayers(['alice', 'bob'], playoffs).pairs[0]!.against.maps).toBe(0)
  })

  it('narrows to a season', () => {
    expect(scopeGraph(graph, { seasonIds: ['other'] }).matches).toEqual([])
    expect(scopeGraph(graph, { seasonIds: ['s'] }).matches).toHaveLength(3)
  })
})

describe('comparePlayers roster fallback', () => {
  const { pairs } = comparePlayers(['alice', 'erin', 'dave', 'frank', 'bob'], graph)
  const pair = (a: string, b: string) => pairs.find((p) => p.a === a && p.b === b)!

  it('counts a series with no map stats from the rosters, using the series score as maps', () => {
    const ae = pair('alice', 'erin')
    expect(ae.againstSeries).toEqual({ won: 1, lost: 0 })
    expect(ae.against).toEqual({ maps: 2, won: 2, lost: 0 })
    expect(ae.fromRosters).toBe(1)
    expect(ae.statsA).toBeNull()
    expect(ae.meetings.map((m) => m.matchId)).toEqual(['m3'])
  })

  it('skips a player who had left the team before the match', () => {
    expect(pair('alice', 'dave').fromRosters).toBe(0)
  })

  it('counts roster teammates as together', () => {
    expect(pair('alice', 'frank').together).toEqual({ maps: 2, won: 2, lost: 0 })
  })

  it('does not use rosters for matches that have map stats', () => {
    // Alice vs Bob still comes only from m1's maps (2 maps, 1-1), not the roster.
    const ab = pair('alice', 'bob')
    expect(ab.against).toEqual({ maps: 2, won: 1, lost: 1 })
    expect(ab.fromRosters).toBe(0)
  })
})

describe('normalizeRosterDates', () => {
  it('clears dates entered after the team finished playing, keeping live ones', () => {
    const out = normalizeRosterDates(
      [
        // Entered months after T1's last match (2026-05-15): retroactive.
        { team_id: 'T1', profile_id: 'x', joined_at: '2026-08-21', left_at: null },
        // Joined mid-season, while T1 was still playing: real.
        { team_id: 'T1', profile_id: 'y', joined_at: '2026-05-05', left_at: null },
        { team_id: 'T3', profile_id: 'z', joined_at: null, left_at: '2026-05-10' },
      ],
      graph.matches
    )
    expect(out[0]!.joined_at).toBeNull()
    expect(out[1]!.joined_at).toBe('2026-05-05')
    expect(out[2]!.left_at).toBe('2026-05-10')
  })
})
