import { env } from '$env/dynamic/private'
import { supabaseAdmin } from '$lib/supabase/admin'
import { resolveTargetSeasonId } from '$lib/server/seasons/resolve'
import { saveMatchVeto } from '$lib/server/matches/reports'
import { listActiveThreads, listMessages, type DiscordConfig } from '$lib/server/discord-events/api'
import { loadActiveSeasonTeams } from '$lib/server/discord-events/sync'
import { parseMatchTitle } from '$lib/server/discord-events/plan'
import { pickMatchForThread, shouldSaveVeto, vetoFromMessages, type ThreadMatch } from './threads'

/**
 * Match scheduling threads, run with the minute sync: link new threads in the
 * scheduling forum to their match by title, then copy any veto log pasted
 * into a linked thread onto the match.
 *
 * The thread ↔ match link is a `discord_posts` row (kind 'match_thread',
 * channel 'scheduling'), the row the announcement webhooks read to know which
 * thread to post a match's updates into. `discord_thread_vetoes` remembers
 * what this sync last read and imported per thread.
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
  vetoes: number
  errors: string[]
}

type CursorRow = {
  thread_id: string
  match_id: string | null
  last_message_id: string | null
  imported_lines: string[] | null
}

export async function runThreadSync(config: DiscordConfig): Promise<ThreadSyncReport> {
  const report: ThreadSyncReport = { configured: false, linked: 0, vetoes: 0, errors: [] }
  const forumId = schedulingForumId()
  if (!forumId) return report
  report.configured = true

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

  // 1. New threads, linked by title ("Team A vs Team B").
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
      } catch (err) {
        report.errors.push(`thread ${thread.id}: ${(err as Error).message}`)
      }
    }
  }

  // 2. Vetoes pasted into linked threads.
  const linked = threads.filter((t) => matchByThread.has(t.id))
  if (linked.length === 0) return report
  const { data: cursorRows } = await supabaseAdmin
    .from(CURSORS)
    .select('thread_id, match_id, last_message_id, imported_lines')
    .in(
      'thread_id',
      linked.map((t) => t.id)
    )
  const cursors = new Map(((cursorRows ?? []) as CursorRow[]).map((c) => [c.thread_id, c]))

  for (const thread of linked) {
    const matchId = matchByThread.get(thread.id)!
    const cursor = cursors.get(thread.id)
    const sameMatch = cursor?.match_id === matchId
    // Nothing new posted since the last read.
    if (sameMatch && cursor?.last_message_id === (thread.last_message_id ?? null)) continue
    try {
      const next = vetoFromMessages(await listMessages(config, thread.id))
      const lastImported = sameMatch ? (cursor?.imported_lines ?? null) : null
      let imported = lastImported
      if (next.length > 0) {
        const { data: match } = await supabaseAdmin
          .from('matches')
          .select('metadata')
          .eq('id', matchId)
          .maybeSingle()
        const metadata = (match?.metadata as Record<string, unknown> | null) ?? {}
        const current = Array.isArray(metadata.map_vetoes) ? (metadata.map_vetoes as string[]) : []
        if (match && shouldSaveVeto({ current, lastImported, next })) {
          await saveMatchVeto(matchId, next)
          imported = next
          report.vetoes++
        }
      }
      await supabaseAdmin.from(CURSORS).upsert({
        thread_id: thread.id,
        match_id: matchId,
        last_message_id: thread.last_message_id ?? null,
        imported_lines: imported,
        updated_at: new Date().toISOString(),
      })
    } catch (err) {
      report.errors.push(`thread ${thread.id} veto: ${(err as Error).message}`)
    }
  }

  return report
}
