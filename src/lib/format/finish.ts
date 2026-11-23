import { ordinal } from './ordinal'

/** "Champion", "3rd", or a shared range like "5th–6th" for a season finish. */
export function finishLabel(finish: { start: number; end: number } | null): string | null {
  if (!finish) return null
  if (finish.start === 1 && finish.end === 1) return 'Champion'
  return finish.start === finish.end
    ? ordinal(finish.start)
    : `${ordinal(finish.start)}–${ordinal(finish.end)}`
}
