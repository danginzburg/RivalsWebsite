import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireProfile, assertCanParticipate } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { enforceRateLimit } from '$lib/server/rate-limit'
import {
  normalizeReviewReason,
  parseReviewEntityType,
  reviewEntityExists,
} from '$lib/server/review-flags'

export const POST: RequestHandler = async ({ request, locals }) => {
  const profile = await requireProfile(locals.user)
  assertCanParticipate(profile)

  const body = await request.json().catch(() => ({}))
  const entityType = parseReviewEntityType(body.entityType)
  const entityId = typeof body.entityId === 'string' ? body.entityId.trim() : ''
  if (!entityId) throw error(400, 'entityId is required')
  const reason = normalizeReviewReason(body.reason)

  enforceRateLimit(`review-flag:${profile.id}`, {
    limit: 10,
    windowMs: 60_000,
    message: 'You are flagging too quickly. Please wait a moment.',
  })

  if (!(await reviewEntityExists(entityType, entityId))) {
    throw error(404, 'That page no longer exists.')
  }

  const { error: insertError } = await supabaseAdmin.from('review_flags').insert({
    entity_type: entityType,
    entity_id: entityId,
    reporter_profile_id: profile.id,
    reason,
  })

  if (insertError) {
    // Partial-unique violation: this user already has an open flag on this entity.
    if (insertError.code === '23505') {
      return json({ success: true, alreadyReported: true })
    }
    console.error('Failed to create review flag:', insertError)
    throw error(500, 'Failed to submit flag')
  }

  return json({ success: true })
}
