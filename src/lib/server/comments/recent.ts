import { supabaseAdmin } from '$lib/supabase/admin'
import { TtlCache } from '$lib/server/cache'
import { authorLabel, ENTITY_TYPES, type CommentEntityType } from './index'

export const EXCERPT_MAX_LENGTH = 160

export type RecentComment = {
  id: string
  excerpt: string
  createdAt: string
  authorName: string
  entityType: CommentEntityType
  /** Human label for the thread the comment lives in, e.g. "Rogue vs Sentinels". */
  entityLabel: string
  /**
   * Path segment identifying the thread's page — the row id for matches and
   * players, the season *code* for seasons, since that is what /events routes on.
   */
  entityRef: string
}

type RecentRow = {
  id: string
  entity_type: string
  entity_id: string
  profile_id: string
  body: string
  created_at: string
}

/**
 * Collapse a comment body to a single line and cap its length.
 * Truncation happens on a word boundary when there is one nearby.
 */
export function toExcerpt(body: string, max = EXCERPT_MAX_LENGTH): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

const recentCommentsCache = new TtlCache<RecentComment[]>({ ttlMs: 30_000, maxEntries: 8 })

/**
 * The newest comments across every thread on the site.
 *
 * Comments whose entity no longer resolves (deleted match, missing season) are
 * dropped rather than rendered as a dead link, so the query over-fetches to
 * still fill the requested count.
 */
export async function loadRecentComments(limit = 8): Promise<RecentComment[]> {
  return recentCommentsCache.wrap(`recent:${limit}`, () => fetchRecentComments(limit))
}

export function invalidateRecentComments(): void {
  recentCommentsCache.clear()
}

async function fetchRecentComments(limit: number): Promise<RecentComment[]> {
  const { data: rows, error } = await supabaseAdmin
    .from('comments')
    .select('id, entity_type, entity_id, profile_id, body, created_at')
    .eq('is_deleted', false)
    .in('entity_type', ENTITY_TYPES as unknown as string[])
    .order('created_at', { ascending: false })
    .limit(limit + 10)

  if (error) {
    // The table may not exist yet if migrations have not been applied.
    console.error('Failed to load recent comments:', error)
    return []
  }

  const comments = (rows ?? []) as RecentRow[]
  if (comments.length === 0) return []

  const [authors, entities] = await Promise.all([
    loadAuthorNames(comments),
    loadEntityRefs(comments),
  ])

  const resolved: RecentComment[] = []
  for (const row of comments) {
    const entity = entities.get(`${row.entity_type}:${row.entity_id}`)
    if (!entity) continue
    resolved.push({
      id: row.id,
      excerpt: toExcerpt(row.body),
      createdAt: row.created_at,
      authorName: authors.get(row.profile_id) ?? 'Unknown',
      entityType: row.entity_type as CommentEntityType,
      entityLabel: entity.label,
      entityRef: entity.ref,
    })
    if (resolved.length === limit) break
  }

  return resolved
}

async function loadAuthorNames(comments: RecentRow[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(comments.map((c) => c.profile_id)))
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, riot_id_base, email, role')
    .in('id', ids)

  const names = new Map<string, string>()
  for (const profile of data ?? []) {
    const row = profile as { id: string }
    names.set(row.id, authorLabel(profile as Parameters<typeof authorLabel>[0]))
  }
  return names
}

type EntityRef = { label: string; ref: string }

/** Resolve display labels and links for every entity referenced in the batch. */
async function loadEntityRefs(comments: RecentRow[]): Promise<Map<string, EntityRef>> {
  const byType = new Map<string, string[]>()
  for (const row of comments) {
    const list = byType.get(row.entity_type)
    if (list) list.push(row.entity_id)
    else byType.set(row.entity_type, [row.entity_id])
  }

  const refs = new Map<string, EntityRef>()

  await Promise.all([
    resolveMatches(byType.get('match') ?? [], refs),
    resolvePlayers(byType.get('player') ?? [], refs),
    resolveSeasons(byType.get('season') ?? [], refs),
  ])

  return refs
}

function teamName(value: unknown): string {
  if (!value) return 'TBD'
  const team = (Array.isArray(value) ? value[0] : value) as { name?: string } | undefined
  return team?.name ?? 'TBD'
}

async function resolveMatches(ids: string[], refs: Map<string, EntityRef>) {
  if (ids.length === 0) return
  const { data } = await supabaseAdmin
    .from('matches')
    .select(
      `id,
       team_a:teams!matches_team_a_id_fkey (name),
       team_b:teams!matches_team_b_id_fkey (name)`
    )
    .in('id', Array.from(new Set(ids)))

  for (const row of data ?? []) {
    const match = row as { id: string; team_a: unknown; team_b: unknown }
    refs.set(`match:${match.id}`, {
      label: `${teamName(match.team_a)} vs ${teamName(match.team_b)}`,
      ref: match.id,
    })
  }
}

async function resolvePlayers(ids: string[], refs: Map<string, EntityRef>) {
  if (ids.length === 0) return
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, riot_id_base, email, role')
    .in('id', Array.from(new Set(ids)))

  for (const row of data ?? []) {
    const profile = row as { id: string }
    refs.set(`player:${profile.id}`, {
      label: authorLabel(row as Parameters<typeof authorLabel>[0]),
      ref: profile.id,
    })
  }
}

async function resolveSeasons(ids: string[], refs: Map<string, EntityRef>) {
  if (ids.length === 0) return
  const { data } = await supabaseAdmin
    .from('seasons')
    .select('id, code, name')
    .in('id', Array.from(new Set(ids)))

  for (const row of data ?? []) {
    const season = row as { id: string; code: string | null; name: string | null }
    // Without a code there is no events route to point at.
    if (!season.code) continue
    refs.set(`season:${season.id}`, {
      label: season.name ?? season.code,
      ref: season.code,
    })
  }
}
