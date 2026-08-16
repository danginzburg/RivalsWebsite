import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireProfile, assertCanParticipate } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { enforceRateLimit } from '$lib/server/rate-limit'
import {
  assertNotCommentBanned,
  loadCommentThread,
  type CommentEntityType,
} from '$lib/server/comments'

/** Accepts 1, -1, or 0 — where 0 means "take my vote back". */
function parseVote(value: unknown): -1 | 0 | 1 {
  if (value === 1 || value === '1') return 1
  if (value === -1 || value === '-1') return -1
  if (value === 0 || value === '0') return 0
  throw error(400, 'value must be 1, -1, or 0')
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const profile = await requireProfile(locals.user)
  assertCanParticipate(profile)

  // A vote is a comment action, so the commenting ban covers it too — otherwise
  // a banned user keeps a way to push threads around.
  const { data: full } = await supabaseAdmin
    .from('profiles')
    .select('id, role, comments_banned_until, comments_ban_reason')
    .eq('id', profile.id)
    .maybeSingle()

  assertNotCommentBanned(full ?? { ...profile, comments_banned_until: null })

  const body = await request.json().catch(() => ({}))
  const commentId = typeof body.commentId === 'string' ? body.commentId.trim() : ''
  if (!commentId) throw error(400, 'commentId is required')
  const value = parseVote(body.value)

  enforceRateLimit(`comment:vote:${profile.id}`, {
    limit: 60,
    windowMs: 60_000,
    message: 'You are voting too quickly. Please wait a moment.',
  })

  const { data: comment } = await supabaseAdmin
    .from('comments')
    .select('id, profile_id, entity_type, entity_id, is_deleted')
    .eq('id', commentId)
    .maybeSingle()

  if (!comment) throw error(404, 'Comment not found')
  if (comment.is_deleted) throw error(400, 'Cannot vote on a deleted comment')
  if (comment.profile_id === profile.id) throw error(403, 'You cannot vote on your own comment')

  if (value === 0) {
    const { error: deleteError } = await supabaseAdmin
      .from('comment_votes')
      .delete()
      .eq('comment_id', commentId)
      .eq('profile_id', profile.id)

    if (deleteError) {
      console.error('Failed to clear comment vote:', deleteError)
      throw error(500, 'Failed to remove your vote')
    }
  } else {
    // Upsert on the composite key: switching from up to down is an update, not
    // a second row. `updated_at` is left to the column default on insert and to
    // the trigger on update — setting it here stamps it from the app clock,
    // which lands it slightly before the database's own `created_at`.
    const { error: upsertError } = await supabaseAdmin
      .from('comment_votes')
      .upsert(
        { comment_id: commentId, profile_id: profile.id, value },
        { onConflict: 'comment_id,profile_id' }
      )

    if (upsertError) {
      console.error('Failed to save comment vote:', upsertError)
      throw error(500, 'Failed to save your vote')
    }
  }

  const comments = await loadCommentThread(
    comment.entity_type as CommentEntityType,
    comment.entity_id,
    { includeReportCounts: profile.role === 'admin', viewerProfileId: profile.id }
  )

  return json({ success: true, comments })
}
