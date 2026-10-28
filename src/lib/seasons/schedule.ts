/**
 * Per-season stage schedule, used to tell visitors where the season is
 * ("Week 3", "Play-ins", "Playoffs").
 *
 * Lives in `seasons.metadata.schedule` next to `profile` and `map_pool`. The
 * season's own `starts_on` / `ends_on` columns bound the whole event; this adds
 * when each stage runs and which weekday closes a regular-season week.
 *
 * Dependency-free and client-safe: the admin editor, the API sanitiser and the
 * home page hero all share it. Dates are plain `YYYY-MM-DD` strings, compared
 * as calendar days with no timezone conversion.
 */

export type SeasonStageKey = 'regular' | 'playins' | 'playoffs'

export const SEASON_STAGE_KEYS: readonly SeasonStageKey[] = [
  'regular',
  'playins',
  'playoffs',
] as const

export const SEASON_STAGE_LABELS: Record<SeasonStageKey, string> = {
  regular: 'Regular season',
  playins: 'Play-ins',
  playoffs: 'Playoffs',
}

export type SeasonStageWindow = { startsOn: string | null; endsOn: string | null }

export type SeasonSchedule = {
  stages: Record<SeasonStageKey, SeasonStageWindow>
  /** Weekday a regular-season week ends on, inclusive. 0 = Sunday … 6 = Saturday. */
  weekEndDay: number
}

export const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function asDate(value: unknown): string | null {
  return typeof value === 'string' && DATE_RE.test(value) ? value : null
}

export function emptySeasonSchedule(): SeasonSchedule {
  return {
    stages: {
      regular: { startsOn: null, endsOn: null },
      playins: { startsOn: null, endsOn: null },
      playoffs: { startsOn: null, endsOn: null },
    },
    weekEndDay: 0,
  }
}

/** Coerce untrusted input (request body or stored metadata) into a schedule. */
export function sanitizeSeasonSchedule(raw: unknown): SeasonSchedule {
  const schedule = emptySeasonSchedule()
  if (!raw || typeof raw !== 'object') return schedule
  const input = raw as Record<string, unknown>

  const stages = (input.stages ?? {}) as Record<string, unknown>
  for (const key of SEASON_STAGE_KEYS) {
    const stage = (stages[key] ?? {}) as Record<string, unknown>
    schedule.stages[key] = { startsOn: asDate(stage.startsOn), endsOn: asDate(stage.endsOn) }
  }

  const day = Number(input.weekEndDay)
  if (Number.isInteger(day) && day >= 0 && day <= 6) schedule.weekEndDay = day
  return schedule
}

export function resolveSeasonSchedule(
  metadata: Record<string, unknown> | null | undefined
): SeasonSchedule {
  return sanitizeSeasonSchedule(metadata?.schedule)
}

/** The viewer's calendar day as `YYYY-MM-DD`. */
export function localDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Whole days from `a` to `b`, both `YYYY-MM-DD`. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay()
}

/**
 * Regular-season week for `today`. A week closes on `weekEndDay` (inclusive),
 * so the count is one plus the week-end days that fell strictly before today.
 * The first week may be short when the stage starts mid-week.
 */
export function regularSeasonWeek(startsOn: string, today: string, weekEndDay: number): number {
  const elapsed = daysBetween(startsOn, today)
  if (elapsed <= 0) return 1
  // Days from the start date to the first week-end on or after it.
  const toFirstEnd = (weekEndDay - weekdayOf(startsOn) + 7) % 7
  if (elapsed <= toFirstEnd) return 1
  return 1 + Math.ceil((elapsed - toFirstEnd) / 7)
}

function formatShortDate(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * Where the season stands on `today`, or null when no stage dates are set.
 * Inside the regular season this is the week; inside play-ins or playoffs it
 * is just the stage name.
 */
export function seasonPhaseLabel(
  schedule: SeasonSchedule,
  season: { startsOn: string | null; endsOn: string | null },
  today: string
): string | null {
  const configured = SEASON_STAGE_KEYS.filter((key) => schedule.stages[key].startsOn)
  if (configured.length === 0) return null

  for (const key of configured) {
    const { startsOn, endsOn } = schedule.stages[key]
    if (startsOn! <= today && (!endsOn || today <= endsOn)) {
      return key === 'regular'
        ? `Week ${regularSeasonWeek(startsOn!, today, schedule.weekEndDay)}`
        : SEASON_STAGE_LABELS[key]
    }
  }

  const firstStart = configured.map((key) => schedule.stages[key].startsOn!).sort()[0]
  const seasonStart = season.startsOn && season.startsOn < firstStart ? season.startsOn : firstStart
  if (today < seasonStart) return `Starts ${formatShortDate(seasonStart)}`

  const upcoming = configured.find((key) => today < schedule.stages[key].startsOn!)
  if (upcoming && (!season.endsOn || today <= season.endsOn)) {
    return `${SEASON_STAGE_LABELS[upcoming]} up next`
  }

  return 'Season complete'
}
