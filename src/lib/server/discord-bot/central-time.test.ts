import { describe, expect, it } from 'vitest'
import {
  centralToUtc,
  eveningTimeChoices,
  parseClock,
  parseDay,
  parseMatchTime,
  upcomingDayChoices,
} from './central-time'

// Tuesday 24 November 2026, noon in Chicago (CST, UTC-6).
const NOW = new Date('2026-11-24T18:00:00Z')

function iso(date: string, time: string) {
  const parsed = parseMatchTime(date, time, NOW)
  return parsed.ok ? parsed.iso : parsed.error
}

describe('centralToUtc', () => {
  it('applies standard and daylight time', () => {
    expect(centralToUtc(2026, 11, 27, 19, 0).toISOString()).toBe('2026-11-28T01:00:00.000Z')
    expect(centralToUtc(2027, 7, 4, 19, 0).toISOString()).toBe('2027-07-05T00:00:00.000Z')
  })

  it('gets the days DST starts and ends right', () => {
    // Daylight time ends 1 Nov 2026 and starts 14 Mar 2027.
    expect(centralToUtc(2026, 11, 1, 19, 0).toISOString()).toBe('2026-11-02T01:00:00.000Z')
    expect(centralToUtc(2027, 3, 14, 19, 0).toISOString()).toBe('2027-03-15T00:00:00.000Z')
  })
})

describe('parseMatchTime', () => {
  it('reads weekdays, today and tomorrow', () => {
    expect(iso('fri', '7pm')).toBe('2026-11-28T01:00:00.000Z')
    expect(iso('Friday', '7 PM')).toBe('2026-11-28T01:00:00.000Z')
    expect(iso('tue', '8pm')).toBe('2026-11-25T02:00:00.000Z')
    expect(iso('today', '8:30pm')).toBe('2026-11-25T02:30:00.000Z')
    expect(iso('tomorrow', '7pm')).toBe('2026-11-26T01:00:00.000Z')
  })

  it('reads numeric and written dates', () => {
    expect(iso('11/28', '7:30 PM')).toBe('2026-11-29T01:30:00.000Z')
    expect(iso('11/28/2026', '7:30pm')).toBe('2026-11-29T01:30:00.000Z')
    expect(iso('2026-11-28', '19:30')).toBe('2026-11-29T01:30:00.000Z')
    expect(iso('Nov 28', '7.30pm')).toBe('2026-11-29T01:30:00.000Z')
    expect(iso('Sat, Nov 28th', '7:30 pm ct')).toBe('2026-11-29T01:30:00.000Z')
    expect(iso('28 November', 'noon')).toBe('2026-11-28T18:00:00.000Z')
  })

  it('takes next year for a month and day that already passed', () => {
    expect(iso('Jan 5', '7pm')).toBe('2027-01-06T01:00:00.000Z')
    expect(iso('7/4', '7pm')).toBe('2027-07-05T00:00:00.000Z')
  })

  it('explains what it could not read', () => {
    expect(iso('someday', '7pm')).toContain("couldn't read the date")
    expect(iso('2/30', '7pm')).toContain("couldn't read the date")
    expect(iso('fri', '7:30')).toContain("couldn't read the time")
    expect(iso('fri', '13pm')).toContain("couldn't read the time")
    expect(iso('today', '9am')).toContain('already passed')
  })
})

describe('parseDay and parseClock', () => {
  it('reads the pieces', () => {
    expect(parseDay('thurs', NOW)).toEqual({ year: 2026, month: 11, day: 26 })
    expect(parseDay('mar 3', NOW)).toEqual({ year: 2027, month: 3, day: 3 })
    expect(parseClock('12am')).toEqual({ hour: 0, minute: 0 })
    expect(parseClock('12pm')).toEqual({ hour: 12, minute: 0 })
    expect(parseClock('07:00')).toEqual({ hour: 7, minute: 0 })
    expect(parseClock('7')).toBeNull()
  })
})

describe('pickers', () => {
  it('offers the next two weeks of days in Central time', () => {
    const days = upcomingDayChoices(NOW)
    expect(days).toHaveLength(14)
    expect(days[0]).toEqual({ name: 'Today, Tue, Nov 24', value: '2026-11-24' })
    expect(days[3]).toEqual({ name: 'Fri, Nov 27', value: '2026-11-27' })
    // Every value reads back as the same day.
    for (const d of days) expect(iso(d.value, '11:30pm')).not.toContain("couldn't")
  })

  it('offers evening times that read back', () => {
    const times = eveningTimeChoices()
    expect(times[0]).toEqual({ name: '5:00 PM CT', value: '5:00 PM' })
    expect(times.at(-1)).toEqual({ name: '11:00 PM CT', value: '11:00 PM' })
    for (const t of times) expect(parseClock(t.value)).not.toBeNull()
  })
})
