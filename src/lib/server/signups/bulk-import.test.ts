import { describe, expect, it, vi } from 'vitest'
import {
  runBulkImport,
  type BulkImportDeps,
  type BulkSignupRow,
  type SignupPatch,
} from './bulk-import'

function row(overrides: Partial<BulkSignupRow> = {}): BulkSignupRow {
  return {
    id: 's1',
    display_name: 'ginzburg',
    riot_tag: 'na1',
    current_rank: null,
    peak_rank: null,
    tracker_current_score: null,
    tracker_peak_score: null,
    ...overrides,
  }
}

function deps(overrides: Partial<BulkImportDeps> = {}) {
  const saved: Array<{ id: string; patch: SignupPatch }> = []
  const base: BulkImportDeps = {
    lookupRiot: vi.fn(async () => ({
      currentRank: 'Gold 1',
      peakRank: 'Platinum 3',
      peakSeasonId: 'act-uuid',
    })),
    lookupTracker: vi.fn(async () => ({ currentScore: 700, peakScore: 611 })),
    save: vi.fn(async (id: string, patch: SignupPatch) => {
      saved.push({ id, patch })
    }),
    delay: vi.fn(async () => {}),
    now: () => 0,
    ...overrides,
  }
  return { deps: base, saved }
}

describe('runBulkImport', () => {
  it('fills blank ranks and scores and recomputes the value', async () => {
    const { deps: d, saved } = deps()
    const report = await runBulkImport([row()], d, { source: 'both' })

    expect(report.updated).toBe(1)
    expect(saved).toHaveLength(1)
    expect(saved[0].patch).toMatchObject({
      current_rank: 'Gold 1',
      peak_rank: 'Platinum 3',
      tracker_current_score: 700,
      tracker_peak_score: 611,
    })
    expect(saved[0].patch.computed_value).toBeGreaterThan(0)
  })

  it('passes the peak act from the Riot lookup into the tracker lookup', async () => {
    const { deps: d } = deps()
    await runBulkImport([row()], d, { source: 'both' })
    expect(d.lookupTracker).toHaveBeenCalledWith('ginzburg#na1', 'act-uuid')
  })

  it('skips rows that already have every value', async () => {
    const { deps: d, saved } = deps()
    const report = await runBulkImport(
      [
        row({
          current_rank: 'Gold 1',
          peak_rank: 'Platinum 3',
          tracker_current_score: 700,
          tracker_peak_score: 611,
        }),
      ],
      d,
      { source: 'both' }
    )

    expect(report.skipped).toBe(1)
    expect(saved).toHaveLength(0)
    expect(d.lookupRiot).not.toHaveBeenCalled()
  })

  it('does not overwrite an existing value unless asked to', async () => {
    const { deps: d, saved } = deps()
    await runBulkImport([row({ current_rank: 'Silver 2' })], d, { source: 'riot' })

    expect(saved[0].patch.current_rank).toBe('Silver 2')
    expect(saved[0].patch.peak_rank).toBe('Platinum 3')
  })

  it('replaces existing values when overwrite is set', async () => {
    const { deps: d, saved } = deps()
    await runBulkImport([row({ current_rank: 'Silver 2' })], d, {
      source: 'riot',
      overwrite: true,
    })

    expect(saved[0].patch.current_rank).toBe('Gold 1')
  })

  it('never touches rows without a Riot tagline', async () => {
    const { deps: d, saved } = deps()
    const report = await runBulkImport([row({ riot_tag: null })], d, { source: 'both' })

    expect(report.skipped).toBe(1)
    expect(saved).toHaveLength(0)
    expect(d.lookupRiot).not.toHaveBeenCalled()
  })

  it('records a failure for one row without sinking the rest', async () => {
    const lookupRiot = vi
      .fn()
      .mockRejectedValueOnce(new Error('Riot lookup is rate limited right now.'))
      .mockResolvedValue({ currentRank: 'Gold 1', peakRank: 'Gold 3', peakSeasonId: null })

    const { deps: d, saved } = deps({ lookupRiot })
    const report = await runBulkImport([row({ id: 'a' }), row({ id: 'b' })], d, { source: 'riot' })

    expect(report.failed).toBe(1)
    expect(report.updated).toBe(1)
    expect(report.rows[0]).toMatchObject({ id: 'a', outcome: 'failed' })
    expect(report.rows[0].detail).toContain('rate limited')
    expect(saved.map((s) => s.id)).toEqual(['b'])
  })

  it('still saves the ranks when only the tracker lookup fails', async () => {
    const { deps: d, saved } = deps({
      lookupTracker: vi.fn(async () => {
        throw new Error('tracker.gg refused the request.')
      }),
    })
    const report = await runBulkImport([row()], d, { source: 'both' })

    expect(report.updated).toBe(1)
    expect(saved[0].patch.current_rank).toBe('Gold 1')
    expect(saved[0].patch.tracker_current_score).toBeNull()
    expect(report.rows[0].detail).toContain('tracker lookup failed')
  })

  it('paces between rows that hit the network but not before the first', async () => {
    const { deps: d } = deps()
    await runBulkImport([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })], d, {
      source: 'riot',
    })
    expect(d.delay).toHaveBeenCalledTimes(2)
  })

  it('does not pace around rows it skipped without a lookup', async () => {
    const { deps: d } = deps()
    await runBulkImport([row({ id: 'a', riot_tag: null }), row({ id: 'b' })], d, {
      source: 'riot',
    })
    expect(d.delay).not.toHaveBeenCalled()
  })

  it('stops on the time budget and reports what is left', async () => {
    let clock = 0
    const { deps: d, saved } = deps({ now: () => clock })
    // Each lookup burns a second of the budget.
    d.lookupRiot = vi.fn(async () => {
      clock += 1000
      return { currentRank: 'Gold 1', peakRank: 'Gold 3', peakSeasonId: null }
    })

    const rows = Array.from({ length: 10 }, (_, i) => row({ id: `s${i}` }))
    const report = await runBulkImport(rows, d, { source: 'riot', timeBudgetMs: 3000 })

    expect(report.stoppedEarly).toBe(true)
    expect(report.processed).toBe(3)
    expect(report.remaining).toBe(7)
    expect(saved).toHaveLength(3)
  })

  it('reports no rank on record as a skip rather than a failure', async () => {
    const { deps: d, saved } = deps({ lookupRiot: vi.fn(async () => null) })
    const report = await runBulkImport([row()], d, { source: 'riot' })

    expect(report.skipped).toBe(1)
    expect(report.failed).toBe(0)
    expect(saved).toHaveLength(0)
    expect(report.rows[0].detail).toContain('no competitive rank on record')
  })
})
