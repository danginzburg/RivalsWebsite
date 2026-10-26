import { describe, expect, it } from 'vitest'
import { sanitizeStandingsConfig, zoneForTeam, zoneRangeLabel } from './standingsZones'

const config = sanitizeStandingsConfig({
  stage: 'playoffs',
  zones: [
    { id: 'out', label: 'Eliminated', tone: 'red', from: 11, to: null },
    { id: 'po', label: 'Playoffs', tone: 'green', from: 1, to: 6 },
    { id: 'lcq', label: 'LCQ', tone: 'amber', from: 7, to: 10 },
  ],
  locked: { teamA: 'po', teamB: 'missing' },
})

describe('sanitizeStandingsConfig', () => {
  it('sorts zones by rank and drops locks to unknown zones', () => {
    expect(config.stage).toBe('playoffs')
    expect(config.zones.map((z) => z.id)).toEqual(['po', 'lcq', 'out'])
    expect(config.locked).toEqual({ teamA: 'po' })
  })

  it('falls back to an empty regular-season config', () => {
    expect(sanitizeStandingsConfig(null)).toEqual({ stage: 'regular', zones: [], locked: {} })
  })

  it('rejects zones without a label or start rank and clamps inverted ranges', () => {
    const { zones } = sanitizeStandingsConfig({
      zones: [
        { label: '', from: 1 },
        { label: 'Bad', from: 0 },
        { label: 'Odd', from: 5, to: 2, tone: 'neon' },
      ],
    })
    expect(zones).toEqual([{ id: 'zone_2', label: 'Odd', tone: 'gray', from: 5, to: 5 }])
  })
})

describe('zoneForTeam', () => {
  it('places a team by rank', () => {
    expect(zoneForTeam(config, 'x', 8)).toMatchObject({ zone: { id: 'lcq' }, locked: false })
    expect(zoneForTeam(config, 'x', 14)).toMatchObject({ zone: { id: 'out' }, locked: false })
    expect(zoneForTeam(config, 'x', null).zone).toBeNull()
  })

  it('prefers a locked zone over rank', () => {
    expect(zoneForTeam(config, 'teamA', 9)).toMatchObject({ zone: { id: 'po' }, locked: true })
  })
})

it('zoneRangeLabel', () => {
  expect(zoneRangeLabel({ from: 1, to: 6 })).toBe('1–6')
  expect(zoneRangeLabel({ from: 11, to: null })).toBe('11+')
  expect(zoneRangeLabel({ from: 4, to: 4 })).toBe('4')
})
