import { describe, expect, it } from 'vitest'

import { batchCoversMatch, resolveMatchStage } from './from-matches'

const S5 = '11111111-1111-4111-8111-111111111111'
const S4 = '22222222-2222-4222-8222-222222222222'

describe('resolveMatchStage', () => {
  it('prefers the stage column', () => {
    expect(
      resolveMatchStage({ id: 'm', stage: 'playins', metadata: { designation: 'Grand Finals' } })
    ).toBe('playins')
  })

  it('falls back to the designation so existing matches need no re-tagging', () => {
    expect(
      resolveMatchStage({ id: 'm', stage: null, metadata: { designation: 'Grand Finals' } })
    ).toBe('playoffs')
    expect(resolveMatchStage({ id: 'm', stage: null, metadata: { designation: 'Week 4' } })).toBe(
      'regular'
    )
  })

  it('leaves a match with nothing to go on unfiled', () => {
    expect(resolveMatchStage({ id: 'm', stage: null, metadata: null })).toBeNull()
    expect(resolveMatchStage({ id: 'm', stage: 'nonsense', metadata: {} })).toBeNull()
  })
})

describe('batchCoversMatch', () => {
  const kickoff = { seasonId: S5, stages: ['kickoff' as const] }

  it('rebuilds a live batch when the match is in its season and stage', () => {
    expect(batchCoversMatch(kickoff, { seasonId: S5, stage: 'kickoff' })).toBe(true)
  })

  it('leaves the kickoff batch alone when a playoffs match is imported', () => {
    expect(batchCoversMatch(kickoff, { seasonId: S5, stage: 'playoffs' })).toBe(false)
  })

  it('leaves it alone for another season entirely', () => {
    expect(batchCoversMatch(kickoff, { seasonId: S4, stage: 'kickoff' })).toBe(false)
    expect(batchCoversMatch(kickoff, { seasonId: null, stage: 'kickoff' })).toBe(false)
  })

  it('covers every stage in the season when no stage filter is set', () => {
    const wholeSeason = { seasonId: S5, stages: [] }
    expect(batchCoversMatch(wholeSeason, { seasonId: S5, stage: 'playoffs' })).toBe(true)
    expect(batchCoversMatch(wholeSeason, { seasonId: S5, stage: null })).toBe(true)
    expect(batchCoversMatch(wholeSeason, { seasonId: S4, stage: 'playoffs' })).toBe(false)
  })

  it('never sweeps an unfiled match into a stage-filtered batch', () => {
    expect(batchCoversMatch(kickoff, { seasonId: S5, stage: null })).toBe(false)
  })

  it('never auto-grows an all-seasons batch — the shape that swallowed history', () => {
    const allSeasons = { seasonId: null, stages: [] }
    expect(batchCoversMatch(allSeasons, { seasonId: S5, stage: 'kickoff' })).toBe(false)
    expect(batchCoversMatch(allSeasons, { seasonId: null, stage: null })).toBe(false)
  })
})
