/**
 * The day a player left a team, for display.
 *
 * left_at is the moment the departure took effect. Rows migrated from day
 * precision hold midnight UTC *after* the last day on the team, so the moment
 * is stepped back by 1ms before formatting; otherwise those rows would read a
 * day late wherever midnight UTC is still the same calendar day.
 */
export function formatLeftDay(value: string): string {
  const bareDay = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const moment = bareDay ? Date.parse(`${value}T12:00:00Z`) : Date.parse(value) - 1
  if (Number.isNaN(moment)) return ''
  return new Date(moment).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
