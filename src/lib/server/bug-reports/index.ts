import { error } from '@sveltejs/kit'

export const BUG_DESCRIPTION_MAX_LENGTH = 2000
export const BUG_DESCRIPTION_MIN_LENGTH = 10
export const BUG_PAGE_PATH_MAX_LENGTH = 512

/** Trim and validate the required "what went wrong" description. */
export function normalizeBugDescription(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (raw.length < BUG_DESCRIPTION_MIN_LENGTH) {
    throw error(400, 'Please describe the bug in a bit more detail so we can look into it.')
  }
  return raw.slice(0, BUG_DESCRIPTION_MAX_LENGTH)
}

/**
 * Keep only a same-origin path (e.g. "/matches/abc?x=1"). We never trust a
 * client-supplied absolute URL, so anything that isn't a leading-slash path is
 * dropped rather than stored.
 */
export function normalizeBugPagePath(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw.startsWith('/')) return null
  return raw.slice(0, BUG_PAGE_PATH_MAX_LENGTH)
}
