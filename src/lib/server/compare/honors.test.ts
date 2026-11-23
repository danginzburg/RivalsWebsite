import { describe, expect, it } from 'vitest'
import { summarizeHonors } from './honors'
import type { TeamHistoryRow } from '$lib/server/players/team-history'

function row(
  partial: Partial<TeamHistoryRow> & { seasonId: string; teamId: string }
): TeamHistoryRow {
  const { seasonId, teamId, ...rest } = partial
  return {
    team: { id: teamId, name: teamId, tag: null, logo_url: null },
    season: { id: seasonId, name: seasonId, code: seasonId },
    role: null,
    joined_at: null,
    left_at: null,
    season_started_on: '',
    placement: null,
    is_mvp: false,
    finish: null,
    finish_missing: false,
    season_kind: 'rivals',
    ...rest,
  }
}

// Newest first, as loadTeamHistory returns it. S3 has two rows: the player
// started on T3a (which went on to win) and moved to T3b (listed first).
const history: TeamHistoryRow[] = [
  row({ seasonId: 's4', teamId: 'T4', finish: { start: 5, end: 6, of: 12 }, is_mvp: true }),
  row({ seasonId: 's3', teamId: 'T3b', finish: { start: 3, end: 3, of: 10 } }),
  row({
    seasonId: 's3',
    teamId: 'T3a',
    finish: { start: 1, end: 1, of: 10 },
    placement: 'champion',
  }),
  row({ seasonId: 's2', teamId: 'T2', finish: { start: 1, end: 1, of: 8 }, placement: 'champion' }),
  row({ seasonId: 'ext', teamId: 'TX', placement: 'champion', season_kind: 'external' }),
]

describe('summarizeHonors', () => {
  it('gives the finish and MVP for a single season', () => {
    const h = summarizeHonors(history, ['s4'])
    expect(h.finish).toEqual({ start: 5, end: 6, of: 12 })
    expect(h.mvps).toBe(1)
    expect(h.championships).toBe(0)
    expect(h.avgFinish).toBeNull()
  })

  it('averages finishes and counts titles and MVPs across seasons, once per season', () => {
    const h = summarizeHonors(history, ['s2', 's3', 's4'])
    // S3 uses the newest row (3rd); S4's shared 5th–6th counts as 5.5.
    expect(h.avgFinish).toBeCloseTo((1 + 3 + 5.5) / 3)
    expect(h.bestFinish).toBe(1)
    expect(h.placedSeasons).toBe(3)
    expect(h.championships).toBe(2)
    expect(h.mvps).toBe(1)
    expect(h.finish).toBeNull()
  })

  it('ignores seasons outside the scope', () => {
    expect(summarizeHonors(history, ['s2', 's3', 's4']).championships).toBe(2)
    expect(summarizeHonors(history, ['ext']).championships).toBe(1)
  })
})
