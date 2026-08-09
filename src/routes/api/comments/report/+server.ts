import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireProfile, assertCanParticipate } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { enforceRateLimit } from '$lib/server/rate-limit'

export const POST: RequestHandler = async ({ request, locals }) => {
  const profile = await requireProfile(locals.user)
  assertCanParticipate(profile)

  const body = await request.json().catch(() => ({}))
  const commentId = typeof body.commentId === 'string' ? body.commentId.trim() : ''
  if (!commentId) throw error(400, 'commentId is required')

  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : null

  enforceRateLimit(`comment:report:${profile.id}`, {
    limit: 10,
    windowMs: 60_000,
    message: 'You are reporting too quickly. Please wait a moment.',
  })

  const { data: comment } = await supabaseAdmin
    .from('comments')
    .select('id, profile_id, is_deleted')
    .eq('id', commentId)
    .maybeSingle()

  if (!comment) throw error(404, 'Comment not found')
  if (comment.is_deleted) throw error(400, 'That comment has already been removed')
  if (comment.profile_id === profile.id) {
    throw error(400, 'You cannot report your own comment')
  }

  const { error: insertError } = await supabaseAdmin.from('comment_reports').insert({
    comment_id: commentId,
    reporter_profile_id: profile.id,
    reason: reason || null,
  })

  if (insertError) {
    // Unique violation: this user already reported this comment.
    if (insertError.code === '23505') {
      return json({ success: true, alreadyReported: true })
    }
    console.error('Failed to create comment report:', insertError)
    throw error(500, 'Failed to submit report')
  }

  return json({ success: true })
}
