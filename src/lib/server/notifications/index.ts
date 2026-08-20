import { supabaseAdmin } from '$lib/supabase/admin'
import type { CommentEntityType } from '$lib/server/comments'

export const NOTIFICATION_TYPES = [
  'signup_approved',
  'signup_rejected',
  'comment_reply',
  'comment_deleted',
  'comment_upvote',
  'result_report_resolved',
  'review_flag_resolved',
  'bug_report_resolved',
] as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export type NotificationRow = {
  id: string
  type: NotificationType
  title: string
  body: string | null
  link: string | null
  actor_count: number
  is_read: boolean
  created_at: string
}

const SELECT_COLUMNS = 'id, type, title, body, link, actor_count, is_read, created_at'

type CreateNotificationInput = {
  recipientProfileId: string
  type: NotificationType
  title: string
  body?: string | null
  link?: string | null
  actorProfileId?: string | null
  entityType?: string | null
  entityId?: string | null
  /**
   * When set, an existing *unread* notification for the same recipient and key
   * is updated in place instead of inserting a new row — so repeated events
   * (e.g. more upvotes on one comment) collapse into a single feed entry.
   */
  dedupeKey?: string | null
  /** Aggregated count shown on a merged row; defaults to 1. */
  actorCount?: number
}

/**
 * Record a notification for a recipient.
 *
 * Never throws: a notification is a side effect of some primary action (posting
 * a comment, approving a signup), and a failure here must not fail that action.
 * Failures are logged and swallowed, mirroring how the comments layer tolerates
 * a missing table.
 */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  try {
    // Don't notify someone about their own action.
    if (input.actorProfileId && input.actorProfileId === input.recipientProfileId) return

    const now = new Date().toISOString()

    if (input.dedupeKey) {
      const { data: existing } = await supabaseAdmin
        .from('notifications')
        .select('id')
        .eq('recipient_profile_id', input.recipientProfileId)
        .eq('dedupe_key', input.dedupeKey)
        .eq('is_read', false)
        .maybeSingle()

      if (existing) {
        // Refresh the open row and float it back to the top of the feed.
        const { error: updateError } = await supabaseAdmin
          .from('notifications')
          .update({
            title: input.title,
            body: input.body ?? null,
            link: input.link ?? null,
            actor_profile_id: input.actorProfileId ?? null,
            actor_count: input.actorCount ?? 1,
            created_at: now,
          })
          .eq('id', existing.id)

        if (updateError) console.error('Failed to update notification:', updateError)
        return
      }
    }

    const { error: insertError } = await supabaseAdmin.from('notifications').insert({
      recipient_profile_id: input.recipientProfileId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      actor_profile_id: input.actorProfileId ?? null,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      dedupe_key: input.dedupeKey ?? null,
      actor_count: input.actorCount ?? 1,
    })

    if (insertError) console.error('Failed to create notification:', insertError)
  } catch (err) {
    console.error('Unexpected error creating notification:', err)
  }
}

/** A recipient's most recent notifications, newest first. */
export async function listNotifications(
  profileId: string,
  options: { limit?: number } = {}
): Promise<NotificationRow[]> {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select(SELECT_COLUMNS)
    .eq('recipient_profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 20)

  if (error) {
    // The table may not exist yet if migrations have not been applied.
    console.error('Failed to load notifications:', error)
    return []
  }

  return (data ?? []) as NotificationRow[]
}

/** How many unread notifications a recipient has. */
export async function countUnread(profileId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_profile_id', profileId)
    .eq('is_read', false)

  if (error) {
    console.error('Failed to count notifications:', error)
    return 0
  }

  return count ?? 0
}

/** Mark specific notifications read. Scoped to the owner so nobody else's rows move. */
export async function markRead(profileId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabaseAdmin
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('recipient_profile_id', profileId)
    .in('id', ids)
    .eq('is_read', false)

  if (error) console.error('Failed to mark notifications read:', error)
}

/** Mark every unread notification for a recipient read. */
export async function markAllRead(profileId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('recipient_profile_id', profileId)
    .eq('is_read', false)

  if (error) console.error('Failed to mark all notifications read:', error)
}

/**
 * Build the page link for a comment on an entity. Seasons route on their `code`,
 * so a lookup is needed; matches and players route on the row id directly.
 * A `#comment-{id}` anchor is appended when the comment id is known.
 */
export async function buildCommentLink(
  entityType: CommentEntityType,
  entityId: string,
  commentId?: string
): Promise<string | null> {
  const anchor = commentId ? `#comment-${commentId}` : ''

  if (entityType === 'match') return `/matches/${entityId}${anchor}`
  if (entityType === 'player') return `/players/${entityId}${anchor}`

  if (entityType === 'season') {
    const { data } = await supabaseAdmin
      .from('seasons')
      .select('code')
      .eq('id', entityId)
      .maybeSingle()
    const code = (data as { code: string | null } | null)?.code
    return code ? `/events/${code}${anchor}` : null
  }

  return null
}
