import { env } from '$env/dynamic/private'
import { supabaseAdmin } from '$lib/supabase/admin'
import { resolveTargetSeasonId } from '$lib/server/seasons/resolve'
import { saveMatchVeto } from '$lib/server/matches/reports'
import {
  editMessage,
  listActiveThreads,
  listMessages,
  sendMessage,
  type DiscordConfig,
} from '$lib/server/discord-events/api'
import { loadActiveSeasonTeams, siteOrigin } from '$lib/server/discord-events/sync'
import { matchUrl, parseMatchTitle } from '$lib/server/discord-events/plan'
import {
  latestVeto,
  linkedMessage,
  pickMatchForThread,
  planVeto,
  vetoHash,
  vetoPromptClosed,
  vetoPromptMessage,
  vetoSavedMessage,
  type ThreadMatch,
} from './threads'

/**
 * Match scheduling threads, run with the minute sync: link new threads in the
 * scheduling forum to their match by title, then copy any veto log pasted
 * into a linked thread onto the match.
 *
 * The thread ↔ match link is a `discord_posts` row (kind 'match_thread',
 * channel 'scheduling'), the row the announcement webhooks read to know which
 * thread to post a match's updates into. `discord_thread_vetoes` remembers,
 * per thread, the veto the bot last saved and any open "Update veto?" prompt.
 * The prompt's buttons are answered in ./interactions.ts.
 */

const POSTS = 'discord_posts'
const CURSORS = 'discord_thread_vetoes'

/** The forum channel teams schedule in, or null when thread sync is off. */
export function schedulingForumId(): string | null {
  return env.DISCORD_SCHEDULING_FORUM_ID?.trim() || null
}

type TeamRel = { id: string; name: string } | Array<{ id: string; name: string }> | null

type MatchRow = {
  id: string
  status: string | null
  scheduled_at: string | null
  team_a: TeamRel
  team_b: TeamRel
}

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null
  return Array.isArray(rel) ? (rel[0] ?? null) : rel
}

/** The active season's scheduled and live matches, soonest first. */
export async function loadOpenMatches(): Promise<ThreadMatch[]> {
  const seasonId = await resolveTargetSeasonId(undefined)
  if (!seasonId) return []
  const { data, error } = await supabaseAdmin
    .from('matches')
    .select(
      `id, status, scheduled_at,
       team_a:teams!matches_team_a_id_fkey (id, name),
       team_b:teams!matches_team_b_id_fkey (id, name)`
    )
    .eq('season_id', seasonId)
    .eq('approval_status', 'approved')
    .in('status', ['scheduled', 'live'])
    .order('scheduled_at', { ascending: true, nullsFirst: false })
  if (error) throw new Error(`Failed to load matches: ${error.message}`)
  return ((data ?? []) as unknown as MatchRow[]).map((row) => ({
    id: row.id,
    status: row.status,
    scheduled_at: row.scheduled_at,
    team_a: one(row.team_a),
    team_b: one(row.team_b),
  }))
}

/**
 * Point a thread at a match. A thread belongs to one match, so any link it had
 * to another match is dropped; a match likewise has one thread, so this
 * replaces the match's previous thread.
 */
export async function linkThreadToMatch(threadId: string, matchId: string): Promise<void> {
  const { error: dropError } = await supabaseAdmin
    .from(POSTS)
    .delete()
    .eq('kind', 'match_thread')
    .eq('channel', 'scheduling')
    .eq('thread_id', threadId)
    .neq('subject_id', matchId)
  if (dropError) throw new Error(`Failed to unlink thread: ${dropError.message}`)

  const { error } = await supabaseAdmin.from(POSTS).upsert(
    {
      kind: 'match_thread',
      subject_id: matchId,
      channel: 'scheduling',
      message_id: threadId,
      thread_id: threadId,
    },
    { onConflict: 'kind,subject_id,channel' }
  )
  if (error) throw new Error(`Failed to link thread: ${error.message}`)
}

export type ThreadSyncReport = {
  configured: boolean
  linked: number
  /** Vetoes saved onto a match (first logs and confirmed updates). */
  vetoes: number
  /** "Update veto?" prompts posted or refreshed. */
  prompts: number
  errors: string[]
}

export type CursorRow = {
  thread_id: string
  match_id: string | null
  last_message_id: string | null
  imported_lines: string[] | null
  pending_lines: string[] | null
  pending_hash: string | null
  pending_message_id: string | null
  pending_author_id: string | null
  dismissed_lines: string[] | null
}

const CURSOR_COLUMNS =
  'thread_id, match_id, last_message_id, imported_lines, pending_lines, pending_hash, pending_message_id, pending_author_id, dismissed_lines'

/** Cursor columns cleared when a prompt is answered or withdrawn. */
export const NO_PROMPT = {
  pending_lines: null,
  pending_hash: null,
  pending_message_id: null,
  pending_author_id: null,
}

export async function loadCursor(threadId: string): Promise<CursorRow | null> {
  const { data } = await supabaseAdmin
    .from(CURSORS)
    .select(CURSOR_COLUMNS)
    .eq('thread_id', threadId)
    .maybeSingle()
  return (data as CursorRow | null) ?? null
}

export async function saveCursor(row: Partial<CursorRow> & { thread_id: string }) {
  const { error } = await supabaseAdmin
    .from(CURSORS)
    .upsert({ ...row, updated_at: new Date().toISOString() })
  if (error) throw new Error(`Failed to save thread state: ${error.message}`)
}

/** The veto on the match now, as the match page stores it. */
export async function loadMatchVeto(matchId: string): Promise<string[] | null> {
  const { data: match } = await supabaseAdmin
    .from('matches')
    .select('metadata')
    .eq('id', matchId)
    .maybeSingle()
  if (!match) return null
  const metadata = (match.metadata as Record<string, unknown> | null) ?? {}
  return Array.isArray(metadata.map_vetoes) ? (metadata.map_vetoes as string[]) : []
}

export async function runThreadSync(
  config: DiscordConfig,
  requestOrigin: string
): Promise<ThreadSyncReport> {
  const report: ThreadSyncReport = {
    configured: false,
    linked: 0,
    vetoes: 0,
    prompts: 0,
    errors: [],
  }
  const forumId = schedulingForumId()
  if (!forumId) return report
  report.configured = true
  const origin = siteOrigin(requestOrigin)

  const threads = (await listActiveThreads(config)).filter((t) => t.parent_id === forumId)
  if (threads.length === 0) return report

  const { data: postRows, error: postsError } = await supabaseAdmin
    .from(POSTS)
    .select('subject_id, thread_id')
    .eq('kind', 'match_thread')
    .eq('channel', 'scheduling')
  if (postsError) throw new Error(`Failed to load thread links: ${postsError.message}`)
  const matchByThread = new Map<string, string>()
  const claimed = new Set<string>()
  for (const row of (postRows ?? []) as Array<{ subject_id: string; thread_id: string | null }>) {
    if (row.thread_id) matchByThread.set(row.thread_id, row.subject_id)
    claimed.add(row.subject_id)
  }

  // 1. New threads, linked by title ("Team A vs Team B"), with a confirmation.
  const unlinked = threads.filter((t) => !matchByThread.has(t.id))
  if (unlinked.length > 0) {
    const [teams, matches] = await Promise.all([loadActiveSeasonTeams(), loadOpenMatches()])
    const now = new Date()
    for (const thread of unlinked) {
      const pair = parseMatchTitle(thread.name, teams)
      if (!pair) continue
      const match = pickMatchForThread(pair, matches, claimed, now)
      if (!match) continue
      try {
        await linkThreadToMatch(thread.id, match.id)
        matchByThread.set(thread.id, match.id)
        claimed.add(match.id)
        report.linked++
        const pairing = `${match.team_a?.name ?? 'TBD'} vs ${match.team_b?.name ?? 'TBD'}`
        await sendMessage(config, thread.id, linkedMessage(pairing, matchUrl(origin, match.id)))
      } catch (err) {
        report.errors.push(`thread ${thread.id}: ${(err as Error).message}`)
      }
    }
  }

  // 2. Vetoes in linked threads. Every linked thread is read each run, not
  // just ones with new messages, so an edited log is noticed too.
  const linked = threads.filter((t) => matchByThread.has(t.id))
  if (linked.length === 0) return report
  const { data: cursorRows } = await supabaseAdmin
    .from(CURSORS)
    .select(CURSOR_COLUMNS)
    .in(
      'thread_id',
      linked.map((t) => t.id)
    )
  const cursors = new Map(((cursorRows ?? []) as CursorRow[]).map((c) => [c.thread_id, c]))

  for (const thread of linked) {
    const matchId = matchByThread.get(thread.id)!
    try {
      await syncThreadVeto(
        config,
        thread.id,
        thread.last_message_id ?? null,
        matchId,
        cursors.get(thread.id),
        origin,
        report
      )
    } catch (err) {
      report.errors.push(`thread ${thread.id} veto: ${(err as Error).message}`)
    }
  }

  return report
}

async function syncThreadVeto(
  config: DiscordConfig,
  threadId: string,
  lastMessageId: string | null,
  matchId: string,
  stored: CursorRow | undefined,
  origin: string,
  report: ThreadSyncReport
) {
  // State kept for another match (the thread was re-linked) doesn't apply.
  const cursor = stored?.match_id === matchId ? stored : undefined
  const current = await loadMatchVeto(matchId)
  if (current == null) return // The match is gone.

  const veto = latestVeto(await listMessages(config, threadId))
  const next = veto?.lines ?? []
  const lastImported = cursor?.imported_lines ?? null
  const action = planVeto({
    current,
    lastImported,
    pending: cursor?.pending_lines,
    dismissed: cursor?.dismissed_lines,
    next,
  })

  const base = {
    thread_id: threadId,
    match_id: matchId,
    last_message_id: lastMessageId,
    imported_lines: lastImported,
    dismissed_lines: cursor?.dismissed_lines ?? null,
  }

  if (action === 'save') {
    await saveMatchVeto(matchId, next)
    report.vetoes++
    await saveCursor({ ...base, ...NO_PROMPT, imported_lines: next })
    await sendMessage(config, threadId, vetoSavedMessage(next, matchUrl(origin, matchId)))
    return
  }

  if (action === 'prompt') {
    const hash = vetoHash(next)
    const body = vetoPromptMessage(next, veto?.authorId ?? null, hash)
    // Refresh the open prompt in place when there is one, so the thread
    // doesn't fill up with questions; post a new one if it was deleted.
    const edited = cursor?.pending_message_id
      ? await editMessage(config, threadId, cursor.pending_message_id, body)
      : null
    const messageId = edited?.id ?? (await sendMessage(config, threadId, body)).id
    report.prompts++
    await saveCursor({
      ...base,
      pending_lines: next,
      pending_hash: hash,
      pending_message_id: messageId,
      pending_author_id: veto?.authorId ?? null,
    })
    return
  }

  if (action === 'withdraw') {
    if (cursor?.pending_message_id) {
      await editMessage(
        config,
        threadId,
        cursor.pending_message_id,
        vetoPromptClosed('withdrawn', null)
      )
    }
    await saveCursor({ ...base, ...NO_PROMPT })
    return
  }

  // Nothing to do; keep the state current (a first sync of this thread, or a re-link).
  if (!stored || stored.match_id !== matchId || stored.last_message_id !== lastMessageId) {
    await saveCursor({
      ...base,
      pending_lines: cursor?.pending_lines ?? null,
      pending_hash: cursor?.pending_hash ?? null,
      pending_message_id: cursor?.pending_message_id ?? null,
      pending_author_id: cursor?.pending_author_id ?? null,
    })
  }
}
