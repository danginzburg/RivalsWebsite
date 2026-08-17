import { error } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'

/** Entities a user can flag for admin review. */
export const REVIEW_ENTITY_TYPES = ['match', 'player'] as const

export type ReviewEntityType = (typeof REVIEW_ENTITY_TYPES)[number]

export const REVIEW_REASON_MAX_LENGTH = 1000
export const REVIEW_REASON_MIN_LENGTH = 5

export function parseReviewEntityType(value: unknown): ReviewEntityType {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!(REVIEW_ENTITY_TYPES as readonly string[]).includes(raw)) {
    throw error(400, `entityType must be one of ${REVIEW_ENTITY_TYPES.join(', ')}`)
  }
  return raw as ReviewEntityType
}

/** Trim and validate the required "what's wrong" description. */
export function normalizeReviewReason(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (raw.length < REVIEW_REASON_MIN_LENGTH) {
    throw error(400, 'Please describe what looks wrong so an admin can check it.')
  }
  return raw.slice(0, REVIEW_REASON_MAX_LENGTH)
}

/**
 * Confirm the flagged entity actually exists before recording a flag, so a bad
 * or stale id cannot pile up dangling review rows. `player` flags target a
 * profile id (the /players/[id] route key); `match` flags target a match id.
 */
export async function reviewEntityExists(
  entityType: ReviewEntityType,
  entityId: string
): Promise<boolean> {
  const table = entityType === 'match' ? 'matches' : 'profiles'
  const { data } = await supabaseAdmin.from(table).select('id').eq('id', entityId).maybeSingle()
  return Boolean(data)
}

/** The page a flag points at, used for the notification link and admin "view in context". */
export function reviewEntityLink(entityType: ReviewEntityType, entityId: string): string {
  return entityType === 'match' ? `/matches/${entityId}` : `/players/${entityId}`
}
