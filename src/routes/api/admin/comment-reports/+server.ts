import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { authorLabel } from '$lib/server/comments'

type ProfileRow = {
  id: string
  display_name: string | null
  riot_id_base: string | null
  email: string | null
  role: string | null
  comments_banned_until?: string | null
}

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const GET: RequestHandler = async ({ locals, url }) => {
  await requireAdmin(locals.user)

  const status = url.searchParams.get('status') ?? 'pending'

  let query = supabaseAdmin
    .from('comment_reports')
    .select('id, comment_id, reporter_profile_id, reason, status, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  if (status !== 'all') query = query.eq('status', status)

  const { data: reports, error: reportsError } = await query
  if (reportsError) throw error(500, 'Failed to load reports')

  const rows = reports ?? []
  if (rows.length === 0) return json({ reports: [] })

  const commentIds = Array.from(new Set(rows.map((r) => r.comment_id)))
  const { data: comments } = await supabaseAdmin
    .from('comments')
    .select('id, entity_type, entity_id, profile_id, body, is_deleted, created_at')
    .in('id', commentIds)

  const commentById = new Map((comments ?? []).map((c) => [c.id, c]))

  const profileIds = Array.from(
    new Set([
      ...rows.map((r) => r.reporter_profile_id),
      ...(comments ?? []).map((c) => c.profile_id),
    ])
  )

  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, riot_id_base, email, role, comments_banned_until')
    .in('id', profileIds)

  const profileById = new Map<string, ProfileRow>(
    ((profiles ?? []) as ProfileRow[]).map((p) => [p.id, p])
  )

  return json({
    reports: rows.map((report) => {
      const comment = commentById.get(report.comment_id)
      const author = comment ? profileById.get(comment.profile_id) : undefined
      return {
        id: report.id,
        status: report.status,
        reason: report.reason,
        created_at: report.created_at,
        reporter: {
          id: report.reporter_profile_id,
          name: authorLabel(profileById.get(report.reporter_profile_id)),
        },
        comment: comment
          ? {
              id: comment.id,
              body: comment.body,
              is_deleted: comment.is_deleted,
              created_at: comment.created_at,
              entity_type: comment.entity_type,
              entity_id: comment.entity_id,
              author: {
                id: comment.profile_id,
                name: authorLabel(author),
                banned_until: author?.comments_banned_until ?? null,
              },
            }
          : null,
      }
    }),
  })
}

export const PATCH: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const action = normalizeOptional(body.action)
  if (!action) throw error(400, 'Missing action')

  const now = new Date().toISOString()

  if (action === 'resolve' || action === 'dismiss') {
    const reportId = normalizeOptional(body.reportId)
    if (!reportId) throw error(400, 'reportId is required')

    const { error: updateError } = await supabaseAdmin
      .from('comment_reports')
      .update({
        status: action === 'resolve' ? 'resolved' : 'dismissed',
        reviewed_by_profile_id: admin.id,
        reviewed_at: now,
      })
      .eq('id', reportId)

    if (updateError) throw error(500, 'Failed to update report')
    return json({ success: true })
  }

  if (action === 'delete_comment') {
    const commentId = normalizeOptional(body.commentId)
    if (!commentId) throw error(400, 'commentId is required')

    const { error: deleteError } = await supabaseAdmin
      .from('comments')
      .update({ is_deleted: true, deleted_by_profile_id: admin.id, deleted_at: now })
      .eq('id', commentId)

    if (deleteError) throw error(500, 'Failed to delete comment')

    await supabaseAdmin
      .from('comment_reports')
      .update({ status: 'resolved', reviewed_by_profile_id: admin.id, reviewed_at: now })
      .eq('comment_id', commentId)
      .eq('status', 'pending')

    return json({ success: true })
  }

  if (action === 'ban') {
    const profileId = normalizeOptional(body.profileId)
    if (!profileId) throw error(400, 'profileId is required')

    // Days omitted or non-positive means a permanent ban.
    const days = Number(body.days)
    const until =
      Number.isFinite(days) && days > 0
        ? new Date(Date.now() + days * 86_400_000).toISOString()
        : new Date('9999-12-31T00:00:00Z').toISOString()

    const { error: banError } = await supabaseAdmin
      .from('profiles')
      .update({
        comments_banned_until: until,
        comments_ban_reason: normalizeOptional(body.reason),
      })
      .eq('id', profileId)

    if (banError) throw error(500, 'Failed to ban user from commenting')
    return json({ success: true })
  }

  if (action === 'unban') {
    const profileId = normalizeOptional(body.profileId)
    if (!profileId) throw error(400, 'profileId is required')

    const { error: unbanError } = await supabaseAdmin
      .from('profiles')
      .update({ comments_banned_until: null, comments_ban_reason: null })
      .eq('id', profileId)

    if (unbanError) throw error(500, 'Failed to lift comment ban')
    return json({ success: true })
  }

  throw error(400, 'Unsupported action')
}
