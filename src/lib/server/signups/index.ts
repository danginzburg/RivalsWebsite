import { error } from '@sveltejs/kit'
import { computePlayerScore, roundRating } from '$lib/signups/formula'

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
  // Negative values are meaningless here; treat them as absent.
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
 * Recompute the stored score from the signup's ranks and the player's
 * imported rating. Returns the rounded value, or null while either rank is
 * missing — an unverified player has no score.
 */
export function computeSignupValue(input: {
  current_rank: string | null
  peak_rank: string | null
  rating: number | null
}): number | null {
  const { total } = computePlayerScore({
    currentRank: input.current_rank,
    peakRank: input.peak_rank,
    rating: input.rating,
  })

  return total == null ? null : roundRating(total)
}

/**
 * The value the calculator should use: the formula score plus the admin's
 * adjustment. A legacy manual override still wins outright where one is set.
 */
export function effectiveValue(signup: {
  computed_value: number | null
  manual_value_override: number | null
  manual_adjustment?: number | null
}): number | null {
  if (signup.manual_value_override != null) return signup.manual_value_override
  if (signup.computed_value == null) return null
  return roundRating(Number(signup.computed_value) + Number(signup.manual_adjustment ?? 0))
}

/** Parse a signed adjustment; blank is 0, unreadable input is null. */
export function parseAdjustment(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function assertValidRankPair(currentRank: string | null, peakRank: string | null) {
  if (!currentRank && !peakRank) {
    throw error(400, 'Enter at least your current rank')
  }
}
