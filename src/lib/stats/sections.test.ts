import { describe, expect, it } from 'vitest'

import {
  MATCH_STAGES,
  inferMatchStageFromLabel,
  inferSectionFromLabel,
  normalizeSectionKey,
  resolveBatchSection,
  sectionLabel,
  sectionOrder,
} from './sections'

describe('normalizeSectionKey', () => {
  it('accepts a known key regardless of casing or padding', () => {
    expect(normalizeSectionKey('  PlayOffs ')).toBe('playoffs')
  })

  it('rejects anything not in the list', () => {
    expect(normalizeSectionKey('finals')).toBeNull()
    expect(normalizeSectionKey(null)).toBeNull()
    expect(normalizeSectionKey(3)).toBeNull()
  })
})

describe('inferSectionFromLabel', () => {
  it('reads the historical batch names', () => {
    expect(inferSectionFromLabel('Season 4 Kickoff (NA)')).toBe('kickoff')
    expect(inferSectionFromLabel('Season 4 (NA)')).toBe('regular')
    expect(inferSectionFromLabel('Season 4 Play-ins [NA]')).toBe('playins')
    expect(inferSectionFromLabel('Season 4 Playoffs [NA]')).toBe('playoffs')
    expect(inferSectionFromLabel('All Time (NA)')).toBe('alltime')
    expect(inferSectionFromLabel('Season 4 [NA] Weeks 1-5')).toBe('weeks')
  })

  it('files a combined post-season batch under playoffs, not play-ins', () => {
    expect(inferSectionFromLabel('Season 4 [NA] Play-ins + Playoffs')).toBe('playoffs')
  })

  it('returns null when the name says nothing about a stage', () => {
    expect(inferSectionFromLabel('scrim dump')).toBeNull()
    expect(inferSectionFromLabel('')).toBeNull()
  })
})

describe('inferMatchStageFromLabel', () => {
  it('maps match designations onto stages', () => {
    expect(inferMatchStageFromLabel('Grand Finals')).toBe('playoffs')
    expect(inferMatchStageFromLabel('Upper Bracket QF')).toBe('playoffs')
    expect(inferMatchStageFromLabel('Play-in Round 1')).toBe('playins')
    expect(inferMatchStageFromLabel('Kickoff')).toBe('kickoff')
  })

  it('treats a week designation as regular season, since matches never sit in Weeks', () => {
    expect(inferMatchStageFromLabel('Week 3')).toBe('regular')
  })

  it('drops batch-only sections', () => {
    expect(inferMatchStageFromLabel('All Time (NA)')).toBeNull()
  })

  it('only ever returns keys a match may be filed under', () => {
    const allowed = new Set(MATCH_STAGES.map((s) => s.key))
    for (const label of ['Grand Finals', 'Play-in', 'Kickoff', 'Week 1', 'Season 3']) {
      const stage = inferMatchStageFromLabel(label)
      expect(stage === null || allowed.has(stage)).toBe(true)
    }
  })
})

describe('resolveBatchSection', () => {
  it('prefers the stored section over the name', () => {
    expect(resolveBatchSection({ section: 'kickoff', display_name: 'Season 4 Playoffs' })).toBe(
      'kickoff'
    )
  })

  it('buckets weekly imports even when the name is unhelpful', () => {
    expect(resolveBatchSection({ import_kind: 'weekly', display_name: 'upload.csv' })).toBe('weeks')
    expect(resolveBatchSection({ week_label: 'Week 2', display_name: 'upload.csv' })).toBe('weeks')
  })

  it('falls back to the name, then to other', () => {
    expect(resolveBatchSection({ display_name: 'Season 2 Playoffs (NA)' })).toBe('playoffs')
    expect(resolveBatchSection({ display_name: 'random.csv' })).toBe('other')
  })
})

describe('ordering', () => {
  it('sorts sections in competition order', () => {
    expect(sectionOrder('kickoff')).toBeLessThan(sectionOrder('regular'))
    expect(sectionOrder('regular')).toBeLessThan(sectionOrder('playins'))
    expect(sectionOrder('playins')).toBeLessThan(sectionOrder('playoffs'))
  })

  it('sorts unknown keys last', () => {
    expect(sectionOrder('nonsense')).toBeGreaterThanOrEqual(sectionOrder('other'))
  })

  it('labels an unknown key as Other rather than throwing', () => {
    expect(sectionLabel('nonsense')).toBe('Other')
    expect(sectionLabel('playins')).toBe('Play-ins')
  })
})
