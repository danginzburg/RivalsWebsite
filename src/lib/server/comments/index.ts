import { error } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'

export const COMMENT_MAX_LENGTH = 2000
export const ENTITY_TYPES = ['match', 'player', 'season'] as const

export type CommentEntityType = (typeof ENTITY_TYPES)[number]

export type CommentAuthor = {
  id: string
  name: string
  role: string | null
}

export type CommentNode = {
  id: string
  body: string | null
  is_deleted: boolean
  created_at: string
  edited_at: string | null
  author: CommentAuthor | null
  /** Reports are only populated for admins. */
  report_count: number
  replies: CommentNode[]
}

type CommentRow = {
  id: string
  entity_type: string
  entity_id: string
  profile_id: string
  parent_id: string | null
  body: string
  is_deleted: boolean
  edited_at: string | null
  created_at: string
}

type ProfileRow = {
  id: string
  display_name: string | null
  riot_id_base: string | null
  email: string | null
  role: string | null
}

export function parseEntityType(value: unknown): CommentEntityType {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!(ENTITY_TYPES as readonly string[]).includes(raw)) {
    throw error(400, `entityType must be one of ${ENTITY_TYPES.join(', ')}`)
  }
  return raw as CommentEntityType
}

export function normalizeBody(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) throw error(400, 'Comment cannot be empty')
  if (raw.length > COMMENT_MAX_LENGTH) {
    throw error(400, `Comment cannot exceed ${COMMENT_MAX_LENGTH} characters`)
  }
  return raw
}

export function authorLabel(profile: ProfileRow | undefined): string {
  if (!profile) return 'Unknown'
  return profile.riot_id_base ?? profile.display_name ?? profile.email ?? 'Player'
}

/**
 * Reject a comment when the author is serving a commenting ban.
 * Admins are never banned from commenting.
 */
export function assertNotCommentBanned(profile: {
  role?: string | null
  comments_banned_until?: string | null
  comments_ban_reason?: string | null
}) {
  if (profile.role === 'admin') return
  const until = profile.comments_banned_until
  if (!until) return

  const expiry = new Date(until)
  if (Number.isFinite(expiry.getTime()) && expiry.getTime() > Date.now()) {
    const reason = profile.comments_ban_reason
    throw error(
      403,
      reason
        ? `You are currently unable to comment: ${reason}`
        : 'You are currently unable to comment.'
    )
  }
}

/**
 * Load a comment thread for an entity, shaped as a two-level tree.
 * Deleted comments are kept as tombstones so replies retain their context,
 * but a deleted comment with no replies is dropped entirely.
 */
export async function loadCommentThread(
  entityType: CommentEntityType,
  entityId: string,
  options: { includeReportCounts?: boolean } = {}
): Promise<CommentNode[]> {
  const { data: rows, error: rowsError } = await supabaseAdmin
    .from('comments')
    .select(
      'id, entity_type, entity_id, profile_id, parent_id, body, is_deleted, edited_at, created_at'
    )
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: true })

  if (rowsError) {
    // The table may not exist yet if migrations have not been applied.
    console.error('Failed to load comments:', rowsError)
    return []
  }

  const comments = (rows ?? []) as CommentRow[]
  if (comments.length === 0) return []

  const profileIds = Array.from(new Set(comments.map((c) => c.profile_id)))
  const { data: profileRows } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, riot_id_base, email, role')
    .in('id', profileIds)

  const profileById = new Map<string, ProfileRow>()
  for (const p of (profileRows ?? []) as ProfileRow[]) profileById.set(p.id, p)

  // Admins see how many open reports each comment has.
  const reportCounts = new Map<string, number>()
  if (options.includeReportCounts) {
    const { data: reportRows } = await supabaseAdmin
      .from('comment_reports')
      .select('comment_id')
      .eq('status', 'pending')
      .in(
        'comment_id',
        comments.map((c) => c.id)
      )
    for (const row of reportRows ?? []) {
      const key = String((row as { comment_id: string }).comment_id)
      reportCounts.set(key, (reportCounts.get(key) ?? 0) + 1)
    }
  }

  const toNode = (row: CommentRow): CommentNode => {
    const profile = profileById.get(row.profile_id)
    return {
      id: row.id,
      body: row.is_deleted ? null : row.body,
      is_deleted: row.is_deleted,
      created_at: row.created_at,
      edited_at: row.edited_at,
      author: row.is_deleted
        ? null
        : {
            id: row.profile_id,
            name: authorLabel(profile),
            role: profile?.role ?? null,
          },
      report_count: reportCounts.get(row.id) ?? 0,
      replies: [],
    }
  }

  const nodeById = new Map<string, CommentNode>()
  const roots: CommentNode[] = []

  for (const row of comments) {
    nodeById.set(row.id, toNode(row))
  }

  for (const row of comments) {
    const node = nodeById.get(row.id)!
    if (row.parent_id && nodeById.has(row.parent_id)) {
      nodeById.get(row.parent_id)!.replies.push(node)
    } else {
      roots.push(node)
    }
  }

  // Drop tombstones that have nothing hanging off them.
  return roots.filter((node) => !node.is_deleted || node.replies.length > 0)
}

/** Total comment count for an entity, excluding deleted rows. */
export async function countComments(entityType: CommentEntityType, entityId: string) {
  const { count } = await supabaseAdmin
    .from('comments')
    .select('id', { count: 'exact', head: true })
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .eq('is_deleted', false)

  return count ?? 0
}
