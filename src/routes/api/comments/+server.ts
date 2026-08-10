import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireProfile, assertCanParticipate } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { enforceRateLimit } from '$lib/server/rate-limit'
import {
  assertNotCommentBanned,
  loadCommentThread,
  normalizeBody,
  parseEntityType,
  type CommentEntityType,
} from '$lib/server/comments'

/** Load the full profile including ban fields. */
async function loadCommenter(user: App.Locals['user']) {
  const profile = await requireProfile(user)
  assertCanParticipate(profile)

  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, role, comments_banned_until, comments_ban_reason')
    .eq('id', profile.id)
    .maybeSingle()

  const full = data ?? { ...profile, comments_banned_until: null, comments_ban_reason: null }
  assertNotCommentBanned(full)
  return full
}

export const GET: RequestHandler = async ({ url, locals }) => {
  const entityType = parseEntityType(url.searchParams.get('entityType'))
  const entityId = url.searchParams.get('entityId')
  if (!entityId) throw error(400, 'entityId is required')

  const isAdmin = locals.user?.role === 'admin'
  const comments = await loadCommentThread(entityType, entityId, {
    includeReportCounts: isAdmin,
  })

  return json({ comments })
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const profile = await loadCommenter(locals.user)
  const body = await request.json().catch(() => ({}))

  const entityType = parseEntityType(body.entityType)
  const entityId = typeof body.entityId === 'string' ? body.entityId.trim() : ''
  if (!entityId) throw error(400, 'entityId is required')

  const text = normalizeBody(body.body)
  const parentId = typeof body.parentId === 'string' && body.parentId ? body.parentId : null

  enforceRateLimit(`comment:post:${profile.id}`, {
    limit: 10,
    windowMs: 60_000,
    message: 'You are commenting too quickly. Please wait a moment.',
  })

  // Replies are one level deep: replying to a reply attaches to its parent.
  let resolvedParentId: string | null = null
  if (parentId) {
    const { data: parent } = await supabaseAdmin
      .from('comments')
      .select('id, parent_id, entity_type, entity_id, is_deleted')
      .eq('id', parentId)
      .maybeSingle()

    if (!parent) throw error(404, 'The comment you replied to no longer exists')
    if (parent.entity_type !== entityType || parent.entity_id !== entityId) {
      throw error(400, 'Parent comment belongs to a different page')
    }
    if (parent.is_deleted) throw error(400, 'Cannot reply to a deleted comment')

    resolvedParentId = parent.parent_id ?? parent.id
  }

  const { error: insertError } = await supabaseAdmin.from('comments').insert({
    entity_type: entityType,
    entity_id: entityId,
    profile_id: profile.id,
    parent_id: resolvedParentId,
    body: text,
  })

  if (insertError) {
    console.error('Failed to create comment:', insertError)
    throw error(500, 'Failed to post comment')
  }

  const comments = await loadCommentThread(entityType, entityId, {
    includeReportCounts: profile.role === 'admin',
  })

  return json({ success: true, comments })
}

export const PATCH: RequestHandler = async ({ request, locals }) => {
  const profile = await loadCommenter(locals.user)
  const body = await request.json().catch(() => ({}))

  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) throw error(400, 'Comment id is required')
  const text = normalizeBody(body.body)

  const { data: existing } = await supabaseAdmin
    .from('comments')
    .select('id, profile_id, entity_type, entity_id, is_deleted')
    .eq('id', id)
    .maybeSingle()

  if (!existing) throw error(404, 'Comment not found')
  if (existing.is_deleted) throw error(400, 'Cannot edit a deleted comment')
  // Editing is author-only — admins moderate by deleting, not rewriting.
  if (existing.profile_id !== profile.id) {
    throw error(403, 'You can only edit your own comments')
  }

  const { error: updateError } = await supabaseAdmin
    .from('comments')
    .update({ body: text, edited_at: new Date().toISOString() })
    .eq('id', id)

  if (updateError) throw error(500, 'Failed to update comment')

  const comments = await loadCommentThread(
    existing.entity_type as CommentEntityType,
    existing.entity_id,
    { includeReportCounts: profile.role === 'admin' }
  )

  return json({ success: true, comments })
}

export const DELETE: RequestHandler = async ({ url, locals }) => {
  const profile = await requireProfile(locals.user)

  const id = url.searchParams.get('id')
  if (!id) throw error(400, 'Comment id is required')

  const { data: existing } = await supabaseAdmin
    .from('comments')
    .select('id, profile_id, entity_type, entity_id')
    .eq('id', id)
    .maybeSingle()

  if (!existing) throw error(404, 'Comment not found')

  const isAdmin = profile.role === 'admin'
  if (!isAdmin && existing.profile_id !== profile.id) {
    throw error(403, 'You can only delete your own comments')
  }

  // Soft delete so replies keep their place in the thread.
  const { error: deleteError } = await supabaseAdmin
    .from('comments')
    .update({
      is_deleted: true,
      deleted_by_profile_id: profile.id,
      deleted_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (deleteError) throw error(500, 'Failed to delete comment')

  // Deleting resolves any open reports against the comment.
  await supabaseAdmin
    .from('comment_reports')
    .update({
      status: 'resolved',
      reviewed_by_profile_id: profile.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('comment_id', id)
    .eq('status', 'pending')

  const comments = await loadCommentThread(
    existing.entity_type as CommentEntityType,
    existing.entity_id,
    { includeReportCounts: isAdmin }
  )

  return json({ success: true, comments })
}
