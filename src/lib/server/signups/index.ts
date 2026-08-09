import { error } from '@sveltejs/kit'
import { computeRatingFromRankNames, roundRating } from '$lib/signups/formula'

export const MAX_TRACKER_LINKS = 5

export type TrackerLink = { label: string; url: string }

/**
 * Normalize the tracker link array submitted by a form.
 * Invalid or non-http URLs are dropped rather than rejected so one bad row
 * does not block an otherwise-valid signup.
 */
export function normalizeTrackerLinks(value: unknown): TrackerLink[] {
  if (!Array.isArray(value)) return []

  const links: TrackerLink[] = []
  for (const raw of value.slice(0, MAX_TRACKER_LINKS)) {
    if (!raw || typeof raw !== 'object') continue
    const url = String((raw as TrackerLink).url ?? '').trim()
    if (!url) continue

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      continue
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue

    const label = String((raw as TrackerLink).label ?? '').trim()
    links.push({
      label: label.slice(0, 60) || parsed.hostname.replace(/^www\./, ''),
      url: parsed.toString(),
    })
  }

  return links
}

export function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Parse a numeric form field, returning null for blank or invalid input. */
export function parseScore(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  // Negative tracker scores are meaningless; treat them as absent.
  return n < 0 ? null : n
}

/**
 * Discord handles are stored as typed, minus a leading @.
 * We do not validate the format beyond length — Discord's rules have changed
 * more than once and a rejected valid handle is worse than a typo.
 */
export function normalizeDiscordHandle(value: unknown): string | null {
  const raw = normalizeOptional(value)
  if (!raw) return null
  return raw.replace(/^@+/, '').slice(0, 64)
}

/**
 * Recompute the stored rating from the signup's current inputs.
 * Returns the rounded value, or null when there is nothing to compute from.
 */
export function computeSignupValue(input: {
  current_rank: string | null
  peak_rank: string | null
  tracker_current_score: number | null
  tracker_peak_score: number | null
}): number | null {
  if (!input.current_rank && !input.peak_rank) return null

  const { rating } = computeRatingFromRankNames({
    currentRank: input.current_rank,
    peakRank: input.peak_rank,
    trackerCurrentScore: input.tracker_current_score,
    trackerPeakScore: input.tracker_peak_score,
  })

  return roundRating(rating)
}

/** The value the calculator should use: manual override wins over the formula. */
export function effectiveValue(signup: {
  computed_value: number | null
  manual_value_override: number | null
}): number | null {
  return signup.manual_value_override ?? signup.computed_value
}

export function assertValidRankPair(currentRank: string | null, peakRank: string | null) {
  if (!currentRank && !peakRank) {
    throw error(400, 'Enter at least your current rank')
  }
}
