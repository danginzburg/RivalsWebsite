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
