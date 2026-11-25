import { env } from '$env/dynamic/private'
import { supabaseAdmin } from '$lib/supabase/admin'
import { resolveTargetSeasonId } from '$lib/server/seasons/resolve'
import { saveMatchVeto } from '$lib/server/matches/reports'
import {
  createForumThread,
  discordConfig,
  editMessage,
  listActiveThreads,
  listMessages,
  sendMessage,
  updateThread,
  type DiscordConfig,
  type DiscordThread,
} from '$lib/server/discord-events/api'
import { loadActiveSeasonTeams, siteOrigin } from '$lib/server/discord-events/sync'
import { matchUrl, parseMatchTitle } from '$lib/server/discord-events/plan'
import { postMatchScheduled } from '$lib/server/discord/announce'
import {
  ORPHAN_GRACE_MS,
  latestVeto,
  linkedMessage,
  matchRemovedMessage,
  messagesSince,
  opponentChangedMessage,
  pickMatchForThread,
  pickOrphanThread,
  designationWeek,
  resultLine,
  weekStartDate,
  planVeto,
  sameLines,
  shouldOpenThread,
  threadCloseReason,
  threadClosedMessage,
  threadOpeningMessage,
  threadTitle,
  vetoHash,
  vetoPromptClosed,
  vetoPromptMessage,
  vetoSavedMessage,
  type NewThreadMatch,
  type OrphanThread,
  type PingTeam,
} from './threads'
import type { ShorthandContext } from './shorthand-veto'
import { centralToUtc } from './central-time'
import { resolveSeasonSchedule } from '$lib/seasons/schedule'

/**
 * Match scheduling threads, run with the minute sync:
 * 1. link threads people opened in the scheduling forum to their match by title;
 * 2. open a thread for each match due one (a week out, or straight away
 *    without a time), pinging both teams' roles; a replacement for a deleted
 *    match takes over that match's thread instead;
 * 3. in each linked thread, notice an opponent swapped on the match, close the
 *    thread once the match is over, and copy a veto posted there onto the match;
 * 4. close deleted matches' threads nobody took over.
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

type TeamRel = PingTeam | PingTeam[] | null

type MatchRow = {
  id: string
  status: string | null
  scheduled_at: string | null
  best_of: number | null
  created_at: string | null
  ended_at: string | null
  updated_at: string | null
  team_a_score: number | null
  team_b_score: number | null
  metadata: Record<string, unknown> | null
  team_a: TeamRel
  team_b: TeamRel
}

const MATCH_COLUMNS = `id, status, scheduled_at, best_of, created_at, ended_at, updated_at,
  team_a_score, team_b_score, metadata,
  team_a:teams!matches_team_a_id_fkey (id, name, discord_role_id),
  team_b:teams!matches_team_b_id_fkey (id, name, discord_role_id)`

type LoadedMatch = NewThreadMatch & {
  ended_at: string | null
  updated_at: string | null
  team_a_score: number | null
  team_b_score: number | null
}

function toMatch(row: MatchRow): LoadedMatch {
  return {
    id: row.id,
    status: row.status,
    scheduled_at: row.scheduled_at,
    best_of: row.best_of,
    created_at: row.created_at,
    ended_at: row.ended_at,
    updated_at: row.updated_at,
    team_a_score: row.team_a_score,
    team_b_score: row.team_b_score,
    designation:
      typeof row.metadata?.designation === 'string' ? (row.metadata.designation as string) : null,
    team_a: one(row.team_a),
    team_b: one(row.team_b),
  }
}

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null
  return Array.isArray(rel) ? (rel[0] ?? null) : rel
}

/** The active season's scheduled and live matches, soonest first. */
export async function loadOpenMatches(): Promise<LoadedMatch[]> {
  const seasonId = await resolveTargetSeasonId(undefined)
  if (!seasonId) return []
  const { data, error } = await supabaseAdmin
    .from('matches')
    .select(MATCH_COLUMNS)
    .eq('season_id', seasonId)
    .eq('approval_status', 'approved')
    .in('status', ['scheduled', 'live'])
    .order('scheduled_at', { ascending: true, nullsFirst: false })
  if (error) throw new Error(`Failed to load matches: ${error.message}`)
  return ((data ?? []) as unknown as MatchRow[]).map(toMatch)
}

/**
 * When an untimed match's thread opens: midnight Central on the first day of
 * the week its designation names ("Week 3"), counted from the active season's
 * regular-season start (Admin → Seasons → Schedule). Null, so it opens at
 * once, when either is missing.
 */
async function loadWeekOpens(): Promise<(match: NewThreadMatch) => Date | null> {
  const seasonId = await resolveTargetSeasonId(undefined)
  if (!seasonId) return () => null
  const { data } = await supabaseAdmin
    .from('seasons')
    .select('metadata')
    .eq('id', seasonId)
    .maybeSingle()
  const schedule = resolveSeasonSchedule(data?.metadata as Record<string, unknown> | null)
  const startsOn = schedule.stages.regular.startsOn
  if (!startsOn) return () => null
  return (match) => {
    const week = designationWeek(match.designation)
    if (!week) return null
    const [y, m, d] = weekStartDate(startsOn, schedule.weekEndDay, week).split('-').map(Number)
    return centralToUtc(y!, m!, d!, 0, 0)
  }
}

/** These matches as they are now, whatever their status; deleted ones are missing. */
async function loadMatchesById(ids: string[]): Promise<Map<string, LoadedMatch>> {
  if (ids.length === 0) return new Map()
  const { data, error } = await supabaseAdmin.from('matches').select(MATCH_COLUMNS).in('id', ids)
  if (error) throw new Error(`Failed to load matches: ${error.message}`)
  return new Map(((data ?? []) as unknown as MatchRow[]).map((row) => [row.id, toMatch(row)]))
}

/**
 * Point a thread at a match. A thread belongs to one match, so any link it had
 * to another match is dropped; a match likewise has one thread, so this
 * replaces the match's previous thread. A thread waiting for a replacement
 * match stops waiting, and its remembered pairing is cleared so a hand-picked
 * link doesn't read as an opponent change.
 */
export async function linkThreadToMatch(threadId: string, matchId: string): Promise<void> {
  await saveCursor({ thread_id: threadId, team_ids: null, orphaned_at: null, closed_at: null })
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
  /** Threads the bot opened, or handed to a replacement match. */
  opened: number
  /** Threads locked because their match is over or gone. */
  closed: number
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
  team_ids: string[] | null
  since_message_id: string | null
  created_by_bot: boolean
  orphaned_at: string | null
  closed_at: string | null
}

const CURSOR_COLUMNS =
  'thread_id, match_id, last_message_id, imported_lines, pending_lines, pending_hash, pending_message_id, pending_author_id, dismissed_lines, team_ids, since_message_id, created_by_bot, orphaned_at, closed_at'

/** Threads opened or taken over per run, to stay clear of Discord's rate limits. */
const MAX_OPENS_PER_RUN = 5

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

type NamedTeam = { name: string; tag: string | null }

/** The match's teams and its season's map pool, for reading a hand-typed veto. */
export async function loadShorthandContext(matchId: string): Promise<ShorthandContext | null> {
  const { data } = await supabaseAdmin
    .from('matches')
    .select(
      `season_id,
       team_a:teams!matches_team_a_id_fkey (name, tag),
       team_b:teams!matches_team_b_id_fkey (name, tag)`
    )
    .eq('id', matchId)
    .maybeSingle()
  if (!data) return null
  const row = data as unknown as {
    season_id: string | null
    team_a: NamedTeam | NamedTeam[] | null
    team_b: NamedTeam | NamedTeam[] | null
  }
  const teams = [one(row.team_a), one(row.team_b)].filter((t): t is NamedTeam => t != null)
  if (teams.length !== 2) return null

  let mapPool: string[] | null = null
  if (row.season_id) {
    const { data: season } = await supabaseAdmin
      .from('seasons')
      .select('metadata')
      .eq('id', row.season_id)
      .maybeSingle()
    const pool = (season?.metadata as Record<string, unknown> | null)?.map_pool
    if (Array.isArray(pool)) {
      const names = pool.filter((m): m is string => typeof m === 'string' && m.trim() !== '')
      mapPool = names.length > 0 ? names : null
    }
  }
  return { teams, mapPool }
}

export async function runThreadSync(
  config: DiscordConfig,
  requestOrigin: string
): Promise<ThreadSyncReport> {
  const report: ThreadSyncReport = {
    configured: false,
    linked: 0,
    opened: 0,
    closed: 0,
    vetoes: 0,
    prompts: 0,
    errors: [],
  }
  const forumId = schedulingForumId()
  if (!forumId) return report
  report.configured = true
  const origin = siteOrigin(requestOrigin)
  const now = new Date()

  const [allThreads, postsResult, orphanResult, matches, weekOpens] = await Promise.all([
    listActiveThreads(config),
    supabaseAdmin
      .from(POSTS)
      .select('subject_id, thread_id, updated_at')
      .eq('kind', 'match_thread')
      .eq('channel', 'scheduling'),
    supabaseAdmin
      .from(CURSORS)
      .select(CURSOR_COLUMNS)
      .not('orphaned_at', 'is', null)
      .is('closed_at', null),
    loadOpenMatches(),
    loadWeekOpens(),
  ])
  if (postsResult.error)
    throw new Error(`Failed to load thread links: ${postsResult.error.message}`)
  if (orphanResult.error) throw new Error(`Failed to load threads: ${orphanResult.error.message}`)
  const threads = allThreads.filter((t) => t.parent_id === forumId)
  const orphans = (orphanResult.data ?? []) as CursorRow[]
  const orphanIds = new Set(orphans.map((o) => o.thread_id))

  const matchByThread = new Map<string, string>()
  const claimed = new Set<string>()
  const stuckClaims: string[] = []
  type PostRow = { subject_id: string; thread_id: string | null; updated_at: string }
  for (const row of (postsResult.data ?? []) as PostRow[]) {
    if (row.thread_id) matchByThread.set(row.thread_id, row.subject_id)
    else if (now.getTime() - new Date(row.updated_at).getTime() > CLAIM_TIMEOUT_MS) {
      // A run that died between claiming a match and opening its thread.
      stuckClaims.push(row.subject_id)
      continue
    }
    claimed.add(row.subject_id)
  }
  if (stuckClaims.length > 0) {
    await supabaseAdmin
      .from(POSTS)
      .delete()
      .eq('kind', 'match_thread')
      .eq('channel', 'scheduling')
      .is('thread_id', null)
      .in('subject_id', stuckClaims)
  }

  // 1. Threads people opened, linked by title ("Team A vs Team B"), with a confirmation.
  const unlinked = threads.filter((t) => !matchByThread.has(t.id) && !orphanIds.has(t.id))
  if (unlinked.length > 0) {
    const teams = await loadActiveSeasonTeams()
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

  // 2. Open a thread for each match that's due one, or hand it a deleted match's thread.
  const available: OrphanThread[] = orphans
    .filter((o) => Array.isArray(o.team_ids) && o.orphaned_at)
    .map((o) => ({ threadId: o.thread_id, teamIds: o.team_ids!, orphanedAt: o.orphaned_at! }))
  const due = matches.filter((m) => !claimed.has(m.id) && shouldOpenThread(m, now, weekOpens(m)))
  for (const match of due.slice(0, MAX_OPENS_PER_RUN)) {
    try {
      const orphan = pickOrphanThread(match, available, now)
      if (orphan) {
        available.splice(available.indexOf(orphan), 1)
        await adoptThread(config, orphan, match, origin)
      } else {
        const opened = await openThread(config, forumId, match, origin)
        if (!opened) continue
      }
      claimed.add(match.id)
      report.opened++
    } catch (err) {
      report.errors.push(`match ${match.id} thread: ${(err as Error).message}`)
    }
  }

  // 3. Linked threads: opponent changes, closing finished matches, then vetoes.
  // Every linked thread is read each run, not just ones with new messages, so
  // an edited log is noticed too.
  const linked = threads.filter((t) => matchByThread.has(t.id))
  if (linked.length > 0) {
    const [{ data: cursorRows }, linkedMatches] = await Promise.all([
      supabaseAdmin
        .from(CURSORS)
        .select(CURSOR_COLUMNS)
        .in(
          'thread_id',
          linked.map((t) => t.id)
        ),
      loadMatchesById([...new Set(linked.map((t) => matchByThread.get(t.id)!))]),
    ])
    const cursors = new Map(((cursorRows ?? []) as CursorRow[]).map((c) => [c.thread_id, c]))

    for (const thread of linked) {
      const matchId = matchByThread.get(thread.id)!
      const match = linkedMatches.get(matchId) ?? null
      try {
        if (!match) {
          // Deleted without going through the site's delete, which hands the thread on first.
          await orphanThread(config, thread.id, null)
          continue
        }
        const reason = threadCloseReason(match)
        if (reason) {
          await closeThread(config, thread.id, reason, matchUrl(origin, matchId), resultLine(match))
          report.closed++
          continue
        }
        const cursor = await syncPairing(config, thread, match, cursors.get(thread.id), origin)
        await syncThreadVeto(
          config,
          thread.id,
          thread.last_message_id ?? null,
          matchId,
          cursor,
          origin,
          report
        )
      } catch (err) {
        report.errors.push(`thread ${thread.id}: ${(err as Error).message}`)
      }
    }
  }

  // 4. Deleted matches' threads that no replacement took over in time.
  for (const orphan of available) {
    if (now.getTime() - new Date(orphan.orphanedAt).getTime() < ORPHAN_GRACE_MS) continue
    try {
      await closeThread(config, orphan.threadId, 'removed', null)
      report.closed++
    } catch (err) {
      report.errors.push(`thread ${orphan.threadId} close: ${(err as Error).message}`)
    }
  }

  return report
}

/** A claim on a match with no thread yet is abandoned after this long. */
const CLAIM_TIMEOUT_MS = 10 * 60 * 1000

/**
 * Open the match's thread in the forum, pinging both teams. The match is
 * claimed first (a link row with no thread yet), so two runs at once can't
 * both open one. False when another run got there first.
 */
async function openThread(
  config: DiscordConfig,
  forumId: string,
  match: NewThreadMatch,
  origin: string
): Promise<boolean> {
  const key = { kind: 'match_thread', subject_id: match.id, channel: 'scheduling' }
  const { error: claimError } = await supabaseAdmin.from(POSTS).insert(key)
  if (claimError) {
    if (claimError.code === '23505') return false
    throw new Error(`Failed to claim the match: ${claimError.message}`)
  }

  let thread: DiscordThread
  try {
    const context = await loadShorthandContext(match.id)
    thread = await createForumThread(
      config,
      forumId,
      threadTitle(match),
      threadOpeningMessage(match, matchUrl(origin, match.id), context?.mapPool ?? null)
    )
  } catch (err) {
    await supabaseAdmin.from(POSTS).delete().match(key).is('thread_id', null)
    throw err
  }

  const { error } = await supabaseAdmin
    .from(POSTS)
    .update({ message_id: thread.id, thread_id: thread.id, updated_at: new Date().toISOString() })
    .match(key)
  if (error) throw new Error(`Failed to link thread: ${error.message}`)
  await saveCursor({
    thread_id: thread.id,
    match_id: match.id,
    team_ids: teamIdsOf(match),
    // The opening message is the thread's first; a veto counts from after it.
    since_message_id: thread.id,
    created_by_bot: true,
    orphaned_at: null,
    closed_at: null,
  })
  await postScheduleIfTimed(match)
  return true
}

/** Hand a deleted match's thread to its replacement, and tell both teams. */
async function adoptThread(
  config: DiscordConfig,
  orphan: OrphanThread,
  match: NewThreadMatch,
  origin: string
) {
  const current = teamIdsOf(match)
  const removed = await teamNames(orphan.teamIds.filter((id) => !current.includes(id)))
  // Unlock first: a locked thread can't be renamed or posted in.
  const thread = await updateThread(config, orphan.threadId, {
    archived: false,
    locked: false,
    name: threadTitle(match),
  })
  if (!thread) {
    // Deleted in Discord: forget it, and the next run opens a fresh thread.
    await saveCursor({ thread_id: orphan.threadId, closed_at: new Date().toISOString() })
    throw new Error('the deleted match’s thread is gone')
  }
  await linkThreadToMatch(orphan.threadId, match.id)
  const notice = await sendMessage(
    config,
    orphan.threadId,
    opponentChangedMessage(removed, match, matchUrl(origin, match.id))
  )
  await saveCursor({
    thread_id: orphan.threadId,
    match_id: match.id,
    team_ids: current,
    since_message_id: notice.id,
    created_by_bot: true,
    imported_lines: null,
    dismissed_lines: null,
    ...NO_PROMPT,
  })
  await postScheduleIfTimed(match)
}

/** A match that already has a time gets its schedule post in its new thread. */
async function postScheduleIfTimed(match: NewThreadMatch) {
  if (!match.scheduled_at) return
  await postMatchScheduled(match.id).catch((err) =>
    console.error(`Schedule post for match ${match.id} failed:`, err)
  )
}

/**
 * Keep the thread in step with its match's teams. An opponent swapped on the
 * match is announced to both teams, and the veto starts over: one the bot
 * copied onto the match is taken off it, and only messages from here on count.
 * A team renamed on the site renames a thread the bot opened.
 * Returns the thread's state as it now stands.
 */
async function syncPairing(
  config: DiscordConfig,
  thread: DiscordThread,
  match: LoadedMatch,
  stored: CursorRow | undefined,
  origin: string
): Promise<CursorRow | undefined> {
  const current = teamIdsOf(match)
  const previous = Array.isArray(stored?.team_ids) ? stored.team_ids : null
  const rename = stored?.created_by_bot === true && thread.name !== threadTitle(match)
  if (rename) await updateThread(config, thread.id, { name: threadTitle(match) })

  if (!previous || sameTeams(previous, current)) {
    if (previous) return stored
    // First look at this thread's pairing: remember it.
    await saveCursor({ thread_id: thread.id, team_ids: current })
    return stored ? { ...stored, team_ids: current } : undefined
  }

  const removed = await teamNames(previous.filter((id) => !current.includes(id)))
  const notice = await sendMessage(
    config,
    thread.id,
    opponentChangedMessage(removed, match, matchUrl(origin, match.id))
  )

  const cursor = stored?.match_id === match.id ? stored : undefined
  const veto = await loadMatchVeto(match.id)
  if (veto && veto.length > 0 && sameLines(veto, cursor?.imported_lines)) {
    await saveMatchVeto(match.id, [])
  }
  if (cursor?.pending_message_id) {
    await editMessage(
      config,
      thread.id,
      cursor.pending_message_id,
      vetoPromptClosed('withdrawn', null)
    ).catch(() => null)
  }
  const reset = {
    match_id: match.id,
    team_ids: current,
    since_message_id: notice.id,
    imported_lines: null,
    dismissed_lines: null,
    ...NO_PROMPT,
  }
  await saveCursor({ thread_id: thread.id, ...reset })
  return stored ? { ...stored, ...reset } : undefined
}

/** Post why, then lock and archive the thread; the sync stops reading it. */
async function closeThread(
  config: DiscordConfig,
  threadId: string,
  reason: 'completed' | 'cancelled' | 'removed',
  url: string | null,
  result: string | null = null
) {
  await sendMessage(config, threadId, threadClosedMessage(reason, url, result)).catch(() => null)
  await updateThread(config, threadId, { archived: true, locked: true })
  await saveCursor({ thread_id: threadId, closed_at: new Date().toISOString() })
}

/**
 * The thread's match is gone: keep the thread for a replacement match to take
 * over (see `pickOrphanThread`), and say so in the thread. Its link row goes,
 * so the announcement webhooks don't post into it meanwhile.
 */
async function orphanThread(config: DiscordConfig, threadId: string, teamIds: string[] | null) {
  const stored = await loadCursor(threadId)
  await saveCursor({
    thread_id: threadId,
    match_id: null,
    team_ids: teamIds ?? stored?.team_ids ?? null,
    orphaned_at: new Date().toISOString(),
    ...NO_PROMPT,
  })
  const { error } = await supabaseAdmin
    .from(POSTS)
    .delete()
    .eq('kind', 'match_thread')
    .eq('channel', 'scheduling')
    .eq('thread_id', threadId)
  if (error) throw new Error(`Failed to unlink thread: ${error.message}`)
  await sendMessage(config, threadId, matchRemovedMessage())
}

/**
 * Call before deleting a match, while its teams can still be read: its thread
 * waits for a replacement match instead of going quiet. Never throws.
 */
export async function orphanMatchThread(matchId: string): Promise<void> {
  const config = discordConfig()
  if (!config || !schedulingForumId()) return
  try {
    const { data: link } = await supabaseAdmin
      .from(POSTS)
      .select('thread_id')
      .eq('kind', 'match_thread')
      .eq('channel', 'scheduling')
      .eq('subject_id', matchId)
      .maybeSingle()
    const threadId = (link as { thread_id: string | null } | null)?.thread_id
    if (!threadId) return
    const match = (await loadMatchesById([matchId])).get(matchId)
    await orphanThread(config, threadId, match ? teamIdsOf(match) : null)
  } catch (err) {
    console.error(`Discord thread hand-off failed for match ${matchId}:`, err)
  }
}

function teamIdsOf(match: Pick<NewThreadMatch, 'team_a' | 'team_b'>): string[] {
  return [match.team_a?.id, match.team_b?.id].filter((id): id is string => Boolean(id))
}

function sameTeams(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id))
}

async function teamNames(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const { data } = await supabaseAdmin.from('teams').select('id, name').in('id', ids)
  const byId = new Map(((data ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t]))
  return ids.map((id) => byId.get(id)?.name ?? 'the previous team')
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

  const [messages, shorthand] = await Promise.all([
    listMessages(config, threadId),
    loadShorthandContext(matchId),
  ])
  // A veto from before an opponent change (or the thread's opening) doesn't count.
  const veto = latestVeto(
    messagesSince(messages, cursor?.since_message_id ?? null),
    shorthand ?? undefined
  )
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
