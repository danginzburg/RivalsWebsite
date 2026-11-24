/**
 * Reading a match time typed in Discord. The league plays on Central time
 * (America/Chicago), so "Fri 7pm" means 7 PM in Chicago, daylight saving
 * included. The result is a UTC ISO string, the only form `scheduled_at` is
 * stored in.
 */

export const LEAGUE_TIME_ZONE = 'America/Chicago'

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: LEAGUE_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  weekday: 'short',
})

type WallClock = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/** The Central wall clock at instant `date`. */
function centralClock(date: Date): WallClock {
  const parts = Object.fromEntries(PARTS.formatToParts(date).map((p) => [p.type, p.value]))
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS.indexOf(String(parts.weekday).toLowerCase().slice(0, 3)),
  }
}

/** Minutes Central is behind UTC at instant `ms` (300 in summer, 360 in winter). */
function centralOffsetMinutes(ms: number): number {
  const c = centralClock(new Date(ms))
  const asUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute)
  return Math.round((Math.floor(ms / 60_000) * 60_000 - asUtc) / 60_000)
}

/** The instant a Central wall-clock time happens. */
export function centralToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute)
  // The offset depends on the instant, so correct twice across a DST change.
  let utc = naive + centralOffsetMinutes(naive) * 60_000
  utc = naive + centralOffsetMinutes(utc) * 60_000
  return new Date(utc)
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** 0–6 for a weekday name or its start ("fri", "thurs", "Friday"), else -1. */
function weekdayIndex(word: string): number {
  const w = word.replace(/\.$/, '')
  if (w.length < 3 || !/^[a-z]+$/.test(w)) return -1
  return WEEKDAY_NAMES.findIndex((name) => name.startsWith(w))
}

type CalendarDay = { year: number; month: number; day: number }

function isRealDay({ year, month, day }: CalendarDay): boolean {
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

function addDays(day: CalendarDay, n: number): CalendarDay {
  const d = new Date(Date.UTC(day.year, day.month - 1, day.day + n))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

/** A month and day with no year: this year, or next year if that date is well past. */
function withYear(month: number, day: number, today: CalendarDay): CalendarDay {
  const thisYear = { year: today.year, month, day }
  const past =
    Date.UTC(today.year, month - 1, day) < Date.UTC(today.year, today.month - 1, today.day - 30)
  return past ? { ...thisYear, year: today.year + 1 } : thisYear
}

/**
 * A day typed as "today", "tomorrow", a weekday ("fri", "Friday": the next
 * one, today included), "11/28", "11/28/2026", "2026-11-28" or "Nov 28".
 */
export function parseDay(text: string, now: Date): CalendarDay | null {
  const value = text.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ')
  const clock = centralClock(now)
  const today: CalendarDay = { year: clock.year, month: clock.month, day: clock.day }

  if (value === 'today' || value === 'tonight') return today
  if (value === 'tomorrow' || value === 'tmrw') return addDays(today, 1)

  const weekday = weekdayIndex(value)
  if (weekday >= 0) return addDays(today, (weekday - clock.weekday + 7) % 7)

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value)
  if (m) {
    const day = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
    return isRealDay(day) ? day : null
  }

  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(value)
  if (m) {
    const month = Number(m[1])
    const dayOfMonth = Number(m[2])
    const day = m[3]
      ? { year: Number(m[3].length === 2 ? `20${m[3]}` : m[3]), month, day: dayOfMonth }
      : withYear(month, dayOfMonth, today)
    return isRealDay(day) ? day : null
  }

  // "Nov 28", "November 28 2026", "28 Nov", optionally after a weekday ("Fri Nov 28").
  const words = value.split(' ').filter((w) => weekdayIndex(w) < 0)
  const monthIndex = words.findIndex((w) => /^[a-z]+\.?$/.test(w) && MONTHS.includes(w.slice(0, 3)))
  if (monthIndex >= 0) {
    const month = MONTHS.indexOf(words[monthIndex]!.slice(0, 3)) + 1
    const numbers = words
      .filter((_, i) => i !== monthIndex)
      .map((w) => /^(\d{1,4})(?:st|nd|rd|th)?$/.exec(w)?.[1])
    if (numbers.some((n) => n === undefined)) return null
    const [dayText, yearText] = numbers as string[]
    if (!dayText || dayText.length > 2) return null
    const day = yearText
      ? { year: Number(yearText), month, day: Number(dayText) }
      : withYear(month, Number(dayText), today)
    return isRealDay(day) ? day : null
  }

  return null
}

/**
 * A time typed as "7pm", "7:30 PM", "7.30pm", "noon" or a 24-hour "19:30".
 * A 12-hour time needs its am or pm: "7:30" alone could be either.
 */
export function parseClock(text: string): { hour: number; minute: number } | null {
  const value = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/ct$|cst$|cdt$|central$/, '')
  if (value === 'noon') return { hour: 12, minute: 0 }
  if (value === 'midnight') return { hour: 0, minute: 0 }

  const m = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm|a|p)?$/.exec(value)
  if (!m) return null
  let hour = Number(m[1])
  const minute = m[2] ? Number(m[2]) : 0
  const meridiem = m[3]?.[0]
  if (minute > 59) return null

  if (meridiem) {
    if (hour < 1 || hour > 12) return null
    if (meridiem === 'a') hour = hour === 12 ? 0 : hour
    else hour = hour === 12 ? 12 : hour + 12
    return { hour, minute }
  }
  // Without am/pm only an unmistakable 24-hour time counts ("19:30", "07:00").
  const twentyFour = hour >= 13 || (m[1]!.length === 2 && m[1]!.startsWith('0')) || hour === 0
  if (!twentyFour || hour > 23 || !m[2]) return null
  return { hour, minute }
}

export type ParsedMatchTime = { ok: true; iso: string; unix: number } | { ok: false; error: string }

/** The instant "date" + "time" (Central) names, or why it can't be read. */
export function parseMatchTime(dateText: string, timeText: string, now: Date): ParsedMatchTime {
  const day = parseDay(dateText, now)
  if (!day) {
    return {
      ok: false,
      error: `I couldn't read the date "${dateText}". Try "Fri", "11/28" or "Nov 28".`,
    }
  }
  const clock = parseClock(timeText)
  if (!clock) {
    return {
      ok: false,
      error: `I couldn't read the time "${timeText}". Try "7pm" or "7:30 PM" (Central).`,
    }
  }
  const when = centralToUtc(day.year, day.month, day.day, clock.hour, clock.minute)
  if (when.getTime() <= now.getTime()) {
    return { ok: false, error: 'That time has already passed. Pick a time in the future.' }
  }
  return { ok: true, iso: when.toISOString(), unix: Math.floor(when.getTime() / 1000) }
}

const DAY_LABEL = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
})

/** The next two weeks of days, for the date picker. Values are YYYY-MM-DD. */
export function upcomingDayChoices(now: Date, days = 14): Array<{ name: string; value: string }> {
  const clock = centralClock(now)
  const today = { year: clock.year, month: clock.month, day: clock.day }
  return Array.from({ length: days }, (_, i) => {
    const d = addDays(today, i)
    const value = `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
    const label = DAY_LABEL.format(new Date(Date.UTC(d.year, d.month - 1, d.day)))
    return { name: i === 0 ? `Today, ${label}` : i === 1 ? `Tomorrow, ${label}` : label, value }
  })
}

/** Evening start times every half hour, for the time picker. */
export function eveningTimeChoices(): Array<{ name: string; value: string }> {
  const choices: Array<{ name: string; value: string }> = []
  for (let minutes = 17 * 60; minutes <= 23 * 60; minutes += 30) {
    const hour = Math.floor(minutes / 60)
    const minute = minutes % 60
    const label = `${hour > 12 ? hour - 12 : hour}:${String(minute).padStart(2, '0')} PM`
    choices.push({ name: `${label} CT`, value: label })
  }
  return choices
}
