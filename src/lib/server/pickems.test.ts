import { describe, expect, it } from 'vitest'

import { getAllowedPickemBucketsForRecord } from '$lib/pickemBuckets'

import {
  buildEmptyBucketPayload,
  getCurrentBuckets,
  scoreBucketSubmission,
  sortPickemSubmissionEntriesByName,
  validateBucketPayload,
} from './pickems'
import type { PickemTeamRow } from './pickems'

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
