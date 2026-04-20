import { describe, expect, it } from 'vitest'

import { getAllowedPickemBucketsForRecord } from '$lib/pickemBuckets'
import type { PickemBucket } from '$lib/pickemBuckets'

import {
  buildEmptyBucketPayload,
  buildPickemWrongPicks,
  buildPickemFinalOutcomes,
  getCurrentBuckets,
  resolveLatestScoringLeaderboardBatch,
  scoreBucketSubmission,
  rankPickemLeaderboardEntries,
  sortPickemSubmissionEntriesByName,
  validateBucketPayload,
  validatePickemFinalLeaderboardForScoring,
} from './pickems'
import type { PickemFinalTeamOutcome, PickemSourceBatch, PickemTeamRow } from './pickems'

function batchStub(
  id: string,
  created_at: string,
  opts: { split?: string; as_of_date?: string | null } = {}
): PickemSourceBatch {
  return {
    id,
    display_name: id,
    source_filename: null,
    created_at,
    as_of_date: opts.as_of_date ?? null,
    split: opts.split ?? 'main',
  }
}

function outcomeStub(
  teamId: string,
  name: string,
  final: { wins: number; losses: number },
  tag: string | null = null
): PickemFinalTeamOutcome {
  return {
    leaderboard_entry_id: 0,
    rank: 1,
    series_played: 3,
    wins: 1,
    losses: 1,
    round_diff: 0,
    team: { id: teamId, name, tag, logo_url: null },
    final_wins: final.wins,
    final_losses: final.losses,
    final_round_diff: 0,
    final_bucket: `${final.wins}-${final.losses}` as PickemBucket,
  }
}

function makeBaselineRowsWithMatchupTags(): PickemTeamRow[] {
  const validTeamIds = Array.from({ length: 24 }, (_, index) => `team-${index + 1}`)
  return validTeamIds.map((id, index) => {
    let wins = 1
    let losses = 1
    if (index < 3) {
      wins = 2
      losses = 0
    } else if (index >= 21) {
      wins = 0
      losses = 2
    }
    const tag = index === 3 ? 'CNRG' : index === 4 ? 'APPL' : null
    return {
      leaderboard_entry_id: index,
      rank: index + 1,
      series_played: wins + losses,
      wins,
      losses,
      round_diff: 0,
      team: {
        id,
        name: `Squad ${index + 1}`,
        tag,
        logo_url: null,
      },
    }
  })
}

describe('pickem helpers', () => {
  it('builds a default bucket payload from team ids', () => {
    const payload = buildEmptyBucketPayload(['a', 'b'])
    expect(payload.buckets['2-1']).toEqual(['a', 'b'])
    expect(payload.buckets['3-0']).toEqual([])
  })

  it('validates exact bucket counts and unique team coverage', () => {
    const validTeamIds = Array.from({ length: 24 }, (_, index) => `team-${index + 1}`)
    const payload = {
      buckets: {
        '3-0': validTeamIds.slice(0, 3),
        '2-1': validTeamIds.slice(3, 12),
        '1-2': validTeamIds.slice(12, 21),
        '0-3': validTeamIds.slice(21, 24),
      },
    }

    expect(validateBucketPayload(payload, validTeamIds, 24)).toEqual(payload)
  })

  it('scores one point per correctly bucketed team', () => {
    const payload = {
      buckets: {
        '3-0': ['a', 'b', 'c'],
        '2-1': ['d', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'],
        '1-2': ['m', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u'],
        '0-3': ['v', 'w', 'x'],
      },
    }

    const finalOutcomes = [
      { team: { id: 'a' }, final_bucket: '3-0' },
      { team: { id: 'd' }, final_bucket: '2-1' },
      { team: { id: 'm' }, final_bucket: '1-2' },
      { team: { id: 'v' }, final_bucket: '0-3' },
      { team: { id: 'b' }, final_bucket: '2-1' },
    ] as any

    expect(scoreBucketSubmission(payload, finalOutcomes)).toBe(4)
  })

  it('derives current buckets for a configurable baseline round count', () => {
    const buckets = getCurrentBuckets(
      [
        { wins: 1, losses: 0, team: { id: 'a' } },
        { wins: 0, losses: 1, team: { id: 'b' } },
      ] as any,
      1
    )

    expect(Object.keys(buckets)).toEqual(['1-0', '0-1'])
    expect(buckets['1-0']).toHaveLength(1)
    expect(buckets['0-1']).toHaveLength(1)
  })

  it('lists allowed final buckets from a 1-0 baseline (one round played)', () => {
    const allowed = getAllowedPickemBucketsForRecord(1, 0, 1, 3)
    expect(allowed).toEqual(expect.arrayContaining(['3-0', '2-1', '1-2']))
    expect(allowed).not.toContain('0-3')
  })

  it('lists only 1-2 and 0-3 for a 0-2 record at baseline 2', () => {
    expect(getAllowedPickemBucketsForRecord(0, 2, 2, 3)).toEqual(['1-2', '0-3'])
  })

  it('rejects a submission that assigns an impossible final bucket for current record', () => {
    const validTeamIds = Array.from({ length: 24 }, (_, index) => `team-${index + 1}`)
    const rows: PickemTeamRow[] = validTeamIds.map((id, index) => {
      let wins = 1
      let losses = 1
      if (index < 3) {
        wins = 2
        losses = 0
      } else if (index >= 21) {
        wins = 0
        losses = 2
      }
      return {
        leaderboard_entry_id: index,
        rank: index + 1,
        series_played: wins + losses,
        wins,
        losses,
        round_diff: 0,
        team: {
          id,
          name: index === 3 ? 'Fourth Team' : `Squad ${index + 1}`,
          tag: null,
          logo_url: null,
        },
      }
    })

    const payload = {
      buckets: {
        '3-0': ['team-2', 'team-3', 'team-4'],
        '2-1': ['team-1', ...validTeamIds.slice(4, 12)],
        '1-2': validTeamIds.slice(12, 21),
        '0-3': validTeamIds.slice(21, 24),
      },
    }

    try {
      validateBucketPayload(payload, validTeamIds, 24, {
        baselineRows: rows,
        baselineCompletedRounds: 2,
        predictionRound: 3,
      })
      expect.fail('expected validateBucketPayload to throw')
    } catch (e: unknown) {
      const text =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null && 'body' in e
            ? String((e as { body?: { message?: string } }).body?.message ?? '')
            : String(e)
      expect(text).toContain('Fourth Team')
      expect(text).toContain('3-0')
    }
  })

  it('rejects matchup buckets that differ but are not a valid head-to-head joint outcome', () => {
    const rows = makeBaselineRowsWithMatchupTags()
    const ids = rows.map((r) => r.team!.id)
    const payload = {
      buckets: {
        '3-0': [ids[0], ids[1], ids[2]],
        '2-1': [ids[3], ids[4], ...ids.slice(5, 12)],
        '1-2': ids.slice(12, 21),
        '0-3': ids.slice(21, 24),
      },
    }

    try {
      validateBucketPayload(payload, ids, 24, {
        baselineRows: rows,
        baselineCompletedRounds: 2,
        predictionRound: 3,
      })
      expect.fail('expected validateBucketPayload to throw')
    } catch (e: unknown) {
      const text =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null && 'body' in e
            ? String((e as { body?: { message?: string } }).body?.message ?? '')
            : String(e)
      expect(text).toContain('head-to-head')
    }
  })

  it('buildPickemWrongPicks returns empty when every submitted bucket matches final', () => {
    const payload = {
      buckets: {
        '3-0': ['a'],
        '2-1': [],
        '1-2': [],
        '0-3': ['b', 'c', 'd'],
      },
    }
    const outcomes: PickemFinalTeamOutcome[] = [
      outcomeStub('a', 'Alpha', { wins: 3, losses: 0 }),
      outcomeStub('b', 'Bravo', { wins: 0, losses: 3 }),
    ]

    const wrong = buildPickemWrongPicks(payload, outcomes)
    expect(wrong).toEqual([])
  })

  it('buildPickemWrongPicks includes predicted and actual bucket labels', () => {
    const payload = {
      buckets: {
        '3-0': ['a'],
        '2-1': [],
        '1-2': [],
        '0-3': ['b', 'c', 'd'],
      },
    }
    const outcomes: PickemFinalTeamOutcome[] = [
      outcomeStub('a', 'Alpha Squad', { wins: 2, losses: 1 }),
      outcomeStub('b', 'Bravo', { wins: 0, losses: 3 }, 'BRV'),
    ]

    const wrong = buildPickemWrongPicks(payload, outcomes)
    expect(wrong).toHaveLength(1)
    expect(wrong[0]).toMatchObject({
      teamId: 'a',
      name: 'Alpha Squad',
      predicted: '3-0',
      actual: '2-1',
    })
  })

  it('sorts submission list entries alphabetically by display name (case-insensitive)', () => {
    const sorted = sortPickemSubmissionEntriesByName([
      {
        id: 'a',
        submittedAt: '2025-01-02',
        user: { id: 'p1', name: 'Zed' },
      },
      {
        id: 'b',
        submittedAt: '2025-01-01',
        user: { id: 'p2', name: 'alpha' },
      },
    ])
    expect(sorted.map((r) => r.user.name)).toEqual(['alpha', 'Zed'])
  })

  it('ranks leaderboard entries by score with competition ties', () => {
    const ranked = rankPickemLeaderboardEntries([
      {
        id: 'a',
        score: 18,
        scoredAt: '2025-04-01T00:00:00.000Z',
        submittedAt: '2025-03-01T00:00:00.000Z',
        wrongPicks: [],
        user: { id: 'p1', name: 'Zed' },
      },
      {
        id: 'b',
        score: 20,
        scoredAt: '2025-04-01T00:00:00.000Z',
        submittedAt: '2025-03-02T00:00:00.000Z',
        wrongPicks: [],
        user: { id: 'p2', name: 'Amy' },
      },
      {
        id: 'c',
        score: 20,
        scoredAt: '2025-04-01T00:00:00.000Z',
        submittedAt: '2025-03-01T12:00:00.000Z',
        wrongPicks: [],
        user: { id: 'p3', name: 'Bob' },
      },
      {
        id: 'd',
        score: 10,
        scoredAt: '2025-04-01T00:00:00.000Z',
        submittedAt: '2025-03-01T00:00:00.000Z',
        wrongPicks: [],
        user: { id: 'p4', name: 'Cal' },
      },
    ])

    expect(ranked.map((r) => [r.id, r.rank])).toEqual([
      ['c', 1],
      ['b', 1],
      ['a', 3],
      ['d', 4],
    ])
  })

  it('breaks score ties by earlier submittedAt, then name', () => {
    const ranked = rankPickemLeaderboardEntries([
      {
        id: 'late',
        score: 5,
        scoredAt: '2025-04-01T00:00:00.000Z',
        submittedAt: '2025-03-02T00:00:00.000Z',
        wrongPicks: [],
        user: { id: 'p1', name: 'Amy' },
      },
      {
        id: 'early',
        score: 5,
        scoredAt: '2025-04-01T00:00:00.000Z',
        submittedAt: '2025-03-01T00:00:00.000Z',
        wrongPicks: [],
        user: { id: 'p2', name: 'Zed' },
      },
      {
        id: 'same-time-a',
        score: 5,
        scoredAt: '2025-04-01T00:00:00.000Z',
        submittedAt: '2025-03-03T00:00:00.000Z',
        wrongPicks: [],
        user: { id: 'p3', name: 'Mia' },
      },
      {
        id: 'same-time-b',
        score: 5,
        scoredAt: '2025-04-01T00:00:00.000Z',
        submittedAt: '2025-03-03T00:00:00.000Z',
        wrongPicks: [],
        user: { id: 'p4', name: 'Noah' },
      },
    ])

    expect(ranked.map((r) => r.id)).toEqual(['early', 'late', 'same-time-a', 'same-time-b'])
  })

  it('accepts a submission where a matchup matches one joint outcome', () => {
    const rows = makeBaselineRowsWithMatchupTags()
    const ids = rows.map((r) => r.team!.id)
    const payload = {
      buckets: {
        '3-0': [ids[0], ids[1], ids[2]],
        '2-1': [ids[3], ...ids.slice(5, 13)],
        '1-2': [ids[4], ...ids.slice(13, 21)],
        '0-3': ids.slice(21, 24),
      },
    }

    expect(
      validateBucketPayload(payload, ids, 24, {
        baselineRows: rows,
        baselineCompletedRounds: 2,
        predictionRound: 3,
      })
    ).toEqual(payload)
  })
})

describe('pickem scoring batch resolution', () => {
  it('picks the newest batch strictly after baseline by created_at', () => {
    const baselineId = 'baseline'
    const baseline = batchStub(baselineId, '2025-01-01T00:00:00.000Z')
    const newest = batchStub('final-new', '2025-01-03T00:00:00.000Z')
    const middle = batchStub('final-mid', '2025-01-02T00:00:00.000Z')
    const ordered = [newest, middle, baseline]

    expect(resolveLatestScoringLeaderboardBatch(baselineId, baseline, ordered)).toEqual(newest)
  })

  it('never returns the baseline batch', () => {
    const baselineId = 'only'
    const baseline = batchStub(baselineId, '2025-01-01T00:00:00.000Z')
    expect(resolveLatestScoringLeaderboardBatch(baselineId, baseline, [baseline])).toBeNull()
  })

  it('allows later scoring batches even when the split label changes', () => {
    const baselineId = 'b1'
    const baseline = batchStub(baselineId, '2025-01-01T00:00:00.000Z', { split: 'main' })
    const otherSplit = batchStub('x1', '2025-01-05T00:00:00.000Z', { split: 'academy' })
    expect(
      resolveLatestScoringLeaderboardBatch(baselineId, baseline, [otherSplit, baseline])
    ).toEqual(otherSplit)
  })

  it('uses as_of_date when both baseline and candidate have it', () => {
    const baselineId = 'b1'
    const baseline = batchStub(baselineId, '2025-01-01T00:00:00.000Z', {
      as_of_date: '2025-04-10',
    })
    const tooOld = batchStub('old', '2025-06-01T00:00:00.000Z', { as_of_date: '2025-04-09' })
    const winner = batchStub('win', '2025-05-01T00:00:00.000Z', { as_of_date: '2025-04-11' })
    const ordered = [winner, tooOld, baseline]

    expect(resolveLatestScoringLeaderboardBatch(baselineId, baseline, ordered)).toEqual(winner)
  })

  it('buildPickemFinalOutcomes maps baseline rows to final buckets', () => {
    const baselineRows: PickemTeamRow[] = [
      {
        leaderboard_entry_id: 1,
        rank: 1,
        series_played: 2,
        wins: 2,
        losses: 0,
        round_diff: 2,
        team: { id: 't1', name: 'A', tag: null, logo_url: null },
      },
      {
        leaderboard_entry_id: 2,
        rank: 2,
        series_played: 2,
        wins: 0,
        losses: 2,
        round_diff: -2,
        team: { id: 't2', name: 'B', tag: null, logo_url: null },
      },
    ]
    const finalSlice: PickemTeamRow[] = [
      {
        leaderboard_entry_id: 10,
        rank: 1,
        series_played: 3,
        wins: 3,
        losses: 0,
        round_diff: 5,
        team: { id: 't1', name: 'A', tag: null, logo_url: null },
      },
      {
        leaderboard_entry_id: 11,
        rank: 2,
        series_played: 3,
        wins: 0,
        losses: 3,
        round_diff: -5,
        team: { id: 't2', name: 'B', tag: null, logo_url: null },
      },
    ]
    validatePickemFinalLeaderboardForScoring(baselineRows, finalSlice, 2, 3)
    const outcomes = buildPickemFinalOutcomes(baselineRows, finalSlice)
    expect(outcomes.map((o) => o.final_bucket)).toEqual(['3-0', '0-3'])
  })

  it('validatePickemFinalLeaderboardForScoring rejects wrong matches_played', () => {
    const baselineRows: PickemTeamRow[] = [
      {
        leaderboard_entry_id: 1,
        rank: 1,
        series_played: 2,
        wins: 1,
        losses: 1,
        round_diff: 0,
        team: { id: 't1', name: 'A', tag: null, logo_url: null },
      },
    ]
    const finalSlice: PickemTeamRow[] = [
      {
        leaderboard_entry_id: 10,
        rank: 1,
        series_played: 2,
        wins: 2,
        losses: 0,
        round_diff: 2,
        team: { id: 't1', name: 'A', tag: null, logo_url: null },
      },
    ]
    try {
      validatePickemFinalLeaderboardForScoring(baselineRows, finalSlice, 1, 3)
      expect.fail('expected validatePickemFinalLeaderboardForScoring to throw')
    } catch (e: unknown) {
      const text =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null && 'body' in e
            ? String((e as { body?: { message?: string } }).body?.message ?? '')
            : String(e)
      expect(text).toContain('matches played')
    }
  })
})
