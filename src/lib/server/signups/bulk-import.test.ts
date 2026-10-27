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
    puuid: null,
    rating: null,
    ...overrides,
  }
}

function deps(overrides: Partial<BulkImportDeps> = {}) {
  const saved: Array<{ id: string; patch: SignupPatch }> = []
  const base: BulkImportDeps = {
    lookupRiot: vi.fn(async () => ({
      currentRank: 'Gold 1',
      peakRank: 'Platinum 3',
    })),
    save: vi.fn(async (id: string, patch: SignupPatch) => {
      saved.push({ id, patch })
    }),
    now: () => 0,
    ...overrides,
  }
  return { deps: base, saved }
}

describe('runBulkImport', () => {
  it('fills blank ranks and recomputes the value', async () => {
    const { deps: d, saved } = deps()
    const report = await runBulkImport([row()], d)

    expect(report.updated).toBe(1)
    expect(saved).toHaveLength(1)
    expect(saved[0].patch).toMatchObject({ current_rank: 'Gold 1', peak_rank: 'Platinum 3' })
    expect(saved[0].patch.computed_value).toBeGreaterThan(0)
  })

  it('adds the rating bonus to the recomputed value', async () => {
    const { deps: d, saved } = deps()
    await runBulkImport([row({ id: 'a' })], d)
    await runBulkImport([row({ id: 'b', rating: 1.2 })], d)

    // Gold 1 (10) and Platinum 3 (15): 0.35·10 + 0.65·15 = 13.25, plus a bonus of 2.
    expect(saved[0].patch.computed_value).toBe(13.25)
    expect(saved[1].patch.computed_value).toBe(15.25)
  })

  it('skips rows that already have both ranks', async () => {
    const { deps: d, saved } = deps()
    const report = await runBulkImport(
      [row({ current_rank: 'Gold 1', peak_rank: 'Platinum 3' })],
      d
    )

    expect(report.skipped).toBe(1)
    expect(saved).toHaveLength(0)
    expect(d.lookupRiot).not.toHaveBeenCalled()
  })

  it('does not overwrite an existing value unless asked to', async () => {
    const { deps: d, saved } = deps()
    await runBulkImport([row({ current_rank: 'Silver 2' })], d, {})

    expect(saved[0].patch.current_rank).toBe('Silver 2')
    expect(saved[0].patch.peak_rank).toBe('Platinum 3')
  })

  it('replaces existing values when overwrite is set', async () => {
    const { deps: d, saved } = deps()
    await runBulkImport([row({ current_rank: 'Silver 2' })], d, { overwrite: true })

    expect(saved[0].patch.current_rank).toBe('Gold 1')
  })

  it('looks up by the linked PUUID, even without a tagline', async () => {
    const { deps: d, saved } = deps()
    await runBulkImport([row({ riot_tag: null, puuid: 'puuid-1' })], d)

    expect(d.lookupRiot).toHaveBeenCalledWith({ riotId: null, puuid: 'puuid-1' }, expect.anything())
    expect(saved).toHaveLength(1)
  })

  it('never touches rows without a linked account or tagline', async () => {
    const { deps: d, saved } = deps()
    const report = await runBulkImport([row({ riot_tag: null })], d, {})

    expect(report.skipped).toBe(1)
    expect(saved).toHaveLength(0)
    expect(d.lookupRiot).not.toHaveBeenCalled()
  })

  it('records a failure for one row without sinking the rest', async () => {
    const lookupRiot = vi
      .fn()
      .mockRejectedValueOnce(new Error('Riot lookup is rate limited right now.'))
      .mockResolvedValue({ currentRank: 'Gold 1', peakRank: 'Gold 3' })

    const { deps: d, saved } = deps({ lookupRiot })
    const report = await runBulkImport([row({ id: 'a' }), row({ id: 'b' })], d, {})

    expect(report.failed).toBe(1)
    expect(report.updated).toBe(1)
    expect(report.rows[0]).toMatchObject({ id: 'a', outcome: 'failed' })
    expect(report.rows[0].detail).toContain('rate limited')
    expect(saved.map((s) => s.id)).toEqual(['b'])
  })

  it('passes the end of its time budget to the lookup as a deadline', async () => {
    const { deps: d } = deps({ now: () => 5000 })
    await runBulkImport([row()], d, { timeBudgetMs: 3000 })
    expect(d.lookupRiot).toHaveBeenCalledWith(expect.anything(), { deadline: 8000 })
  })

  it('pauses on a rate limit, leaving the row for the next call', async () => {
    const limited = Object.assign(new Error('rate limited'), { status: 429, retryAfterMs: 12_000 })
    const lookupRiot = vi
      .fn()
      .mockResolvedValueOnce({ currentRank: 'Gold 1', peakRank: 'Gold 3' })
      .mockRejectedValueOnce(limited)

    const { deps: d, saved } = deps({ lookupRiot })
    const rows = [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })]
    const report = await runBulkImport(rows, d, {})

    expect(report.failed).toBe(0)
    expect(report.processed).toBe(1)
    expect(report.stoppedEarly).toBe(true)
    expect(report.remaining).toBe(2)
    expect(report.retryAfterMs).toBe(12_000)
    expect(saved.map((s) => s.id)).toEqual(['a'])
    expect(lookupRiot).toHaveBeenCalledTimes(2)
  })

  it('stops on the time budget and reports what is left', async () => {
    let clock = 0
    const { deps: d, saved } = deps({ now: () => clock })
    // Each lookup burns a second of the budget.
    d.lookupRiot = vi.fn(async () => {
      clock += 1000
      return { currentRank: 'Gold 1', peakRank: 'Gold 3' }
    })

    const rows = Array.from({ length: 10 }, (_, i) => row({ id: `s${i}` }))
    const report = await runBulkImport(rows, d, { timeBudgetMs: 3000 })

    expect(report.stoppedEarly).toBe(true)
    expect(report.processed).toBe(3)
    expect(report.remaining).toBe(7)
    expect(saved).toHaveLength(3)
  })

  it('reports no rank on record as a skip rather than a failure', async () => {
    const { deps: d, saved } = deps({ lookupRiot: vi.fn(async () => null) })
    const report = await runBulkImport([row()], d, {})

    expect(report.skipped).toBe(1)
    expect(report.failed).toBe(0)
    expect(saved).toHaveLength(0)
    expect(report.rows[0].detail).toContain('no competitive rank since V26 Act 1')
  })
})
