import { describe, expect, it } from 'vitest'

import {
  emptySeasonSchedule,
  regularSeasonWeek,
  sanitizeSeasonSchedule,
  seasonPhaseLabel,
  type SeasonSchedule,
} from './schedule'

// 2026-11-02 is a Monday.
function schedule(): SeasonSchedule {
  const s = emptySeasonSchedule()
  s.stages.regular = { startsOn: '2026-11-02', endsOn: '2026-11-29' }
  s.stages.playins = { startsOn: '2026-12-01', endsOn: '2026-12-03' }
  s.stages.playoffs = { startsOn: '2026-12-05', endsOn: '2026-12-13' }
  s.weekEndDay = 0 // Sunday
  return s
}

const season = { startsOn: '2026-11-02', endsOn: '2026-12-13' }

describe('regularSeasonWeek', () => {
  it('counts the week-end day itself as part of its week', () => {
    expect(regularSeasonWeek('2026-11-02', '2026-11-02', 0)).toBe(1)
    expect(regularSeasonWeek('2026-11-02', '2026-11-08', 0)).toBe(1)
    expect(regularSeasonWeek('2026-11-02', '2026-11-09', 0)).toBe(2)
    expect(regularSeasonWeek('2026-11-02', '2026-11-15', 0)).toBe(2)
    expect(regularSeasonWeek('2026-11-02', '2026-11-16', 0)).toBe(3)
  })

  it('gives a mid-week start a short first week', () => {
    // Starts Friday, weeks end Sunday: Fri–Sun is week 1, Monday is week 2.
    expect(regularSeasonWeek('2026-11-06', '2026-11-08', 0)).toBe(1)
    expect(regularSeasonWeek('2026-11-06', '2026-11-09', 0)).toBe(2)
  })

  it('handles a start that falls on the week-end day', () => {
    // Starts Sunday, weeks end Sunday: that Sunday alone is week 1.
    expect(regularSeasonWeek('2026-11-01', '2026-11-01', 0)).toBe(1)
    expect(regularSeasonWeek('2026-11-01', '2026-11-02', 0)).toBe(2)
  })
})

describe('seasonPhaseLabel', () => {
  it('is null with no stage dates', () => {
    expect(seasonPhaseLabel(emptySeasonSchedule(), season, '2026-11-10')).toBeNull()
  })

  it('shows the week during the regular season', () => {
    expect(seasonPhaseLabel(schedule(), season, '2026-11-10')).toBe('Week 2')
  })

  it('shows only the stage name in play-ins and playoffs', () => {
    expect(seasonPhaseLabel(schedule(), season, '2026-12-02')).toBe('Play-ins')
    expect(seasonPhaseLabel(schedule(), season, '2026-12-13')).toBe('Playoffs')
  })

  it('names the next stage in a gap between stages', () => {
    expect(seasonPhaseLabel(schedule(), season, '2026-11-30')).toBe('Play-ins up next')
  })

  it('reports before the start and after the end', () => {
    expect(seasonPhaseLabel(schedule(), season, '2026-10-20')).toMatch(/^Starts /)
    expect(seasonPhaseLabel(schedule(), season, '2026-12-20')).toBe('Season complete')
  })
})

describe('sanitizeSeasonSchedule', () => {
  it('drops malformed dates and out-of-range weekdays', () => {
    const s = sanitizeSeasonSchedule({
      stages: { regular: { startsOn: 'nope', endsOn: '2026-11-29' } },
      weekEndDay: 9,
    })
    expect(s.stages.regular).toEqual({ startsOn: null, endsOn: '2026-11-29' })
    expect(s.weekEndDay).toBe(0)
  })
})
