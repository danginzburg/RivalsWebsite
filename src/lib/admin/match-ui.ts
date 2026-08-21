/** Shared helpers for admin match / team UI (used by the admin dashboard). */

export function toDatetimeLocal(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`
}

/**
 * Inverse of {@link toDatetimeLocal}: turn a `<input type="datetime-local">`
 * value (a bare wall-clock string with no timezone) into an absolute UTC ISO
 * string. This MUST run in the browser so the viewer's timezone is applied —
 * `new Date('2026-08-21T14:00')` uses the runtime's local zone, and on the
 * server that's UTC, which silently shifts the stored time. Returns null for
 * empty/invalid input.
 */
export function fromDatetimeLocal(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return date.toISOString()
}

export function teamName(value: unknown): string {
  if (!value) return 'Team'
  if (Array.isArray(value)) {
    const first = value[0] as { name?: string } | undefined
    return first?.name ?? 'Team'
  }
  const team = value as { name?: string }
  return team.name ?? 'Team'
}

export function formatUtc(value: string | null | undefined): string {
  if (!value) return 'No date'
  const date = new Date(value)
  return `${date.toLocaleString(undefined, { timeZone: 'UTC' })} UTC`
}
