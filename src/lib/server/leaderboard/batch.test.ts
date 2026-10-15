import { describe, expect, it } from 'vitest'
import { COMPUTED_SOURCE, orderStandingsBatches, pickStandingsBatch } from './batch'

const csvNew = { id: 'csv-new', metadata: { import_type: 'leaderboard_entries' } }
const csvOld = { id: 'csv-old', metadata: { import_type: 'leaderboard_entries' } }
const computed = { id: 'calc', metadata: { source: COMPUTED_SOURCE, match_count: 12 } }
const computedEmpty = { id: 'calc-empty', metadata: { source: COMPUTED_SOURCE, match_count: 0 } }

describe('pickStandingsBatch', () => {
  it('prefers calculated standings over a newer CSV import', () => {
    expect(pickStandingsBatch([csvNew, computed, csvOld])?.id).toBe('calc')
  })

  it('falls back to the newest import when the calculation had no matches', () => {
    expect(pickStandingsBatch([computedEmpty, csvNew, csvOld])?.id).toBe('calc-empty')
    expect(pickStandingsBatch([csvNew, computedEmpty])?.id).toBe('csv-new')
  })

  it('returns null for no batches', () => {
    expect(pickStandingsBatch([])).toBeNull()
  })
})

describe('orderStandingsBatches', () => {
  it('moves the preferred batch to the front and keeps the rest in order', () => {
    expect(orderStandingsBatches([csvNew, csvOld, computed]).map((b) => b.id)).toEqual([
      'calc',
      'csv-new',
      'csv-old',
    ])
  })
})
