import { createHash } from 'node:crypto'
import { extractVetoLogLines, normalizeVetoLines } from '$lib/matches/vetoLog'
import { parseShorthandVeto, type ShorthandContext } from './shorthand-veto'

/**
 * Match scheduling threads: the pure part. Teams open one forum thread per
 * match to agree a time and run the map veto. The bot links each thread to
 * its match (from the title, or by `/link-match`) and copies a veto log pasted
 * into the thread onto the match.
 */

export type ThreadMatch = {
  id: string
  status: string | null
  scheduled_at: string | null
  team_a: { id: string; name: string } | null
  team_b: { id: string; name: string } | null
}

/** The fields of a Discord message the veto import reads. */
export type ThreadMessage = {
  id: string
  author?: { id: string } | null
  content?: string | null
  embeds?: Array<{ description?: string | null; fields?: Array<{ value?: string | null }> }>
}

const OPEN_STATUSES = new Set(['scheduled', 'live'])

/**
 * The match a thread titled with this pairing is about: their next open match,
 * among those no other thread has claimed yet. Matches with a time come first,
 * soonest first, and unscheduled ones after; a thread is usually opened before
 * the time is agreed.
 */
export function pickMatchForThread(
  pair: [{ id: string }, { id: string }],
  candidates: ThreadMatch[],
  claimedMatchIds: Set<string>,
  now: Date
): ThreadMatch | null {
  const ids = new Set([pair[0].id, pair[1].id])
  // A match whose time passed more than a day ago without a result isn't "next".
  const stale = now.getTime() - 24 * 60 * 60 * 1000
  const open = candidates.filter(
    (m) =>
      OPEN_STATUSES.has(m.status ?? '') &&
      m.team_a &&
      m.team_b &&
      ids.has(m.team_a.id) &&
      ids.has(m.team_b.id) &&
      m.team_a.id !== m.team_b.id &&
      !claimedMatchIds.has(m.id) &&
      (!m.scheduled_at || new Date(m.scheduled_at).getTime() >= stale)
  )
  const at = (m: ThreadMatch) =>
    m.scheduled_at ? new Date(m.scheduled_at).getTime() : Number.POSITIVE_INFINITY
  open.sort((a, b) => at(a) - at(b))
  return open[0] ?? null
}

/** Strip the Markdown people paste a log inside: code fences, quotes, bullets. */
function cleanLine(line: string): string {
  return line
    .replace(/^\s*(?:```\w*|`|>+|[-*•])\s*/, '')
    .replace(/`+\s*$/, '')
    .trim()
}

function messageLines(message: ThreadMessage): string[] {
  const texts = [message.content ?? '']
  for (const embed of message.embeds ?? []) {
    texts.push(embed.description ?? '')
    for (const field of embed.fields ?? []) texts.push(field.value ?? '')
  }
  return texts.flatMap((text) => text.split(/\r?\n/)).map(cleanLine)
}

export type ThreadVeto = {
  /** The veto as the match page stores it. */
  lines: string[]
  /** Who posted it, so they can confirm an update. */
  authorId: string | null
}

/** A hand-typed veto may run over this many back-to-back messages from one person (a line each, say). */
const SHORTHAND_SPAN = 12

/**
 * The veto a thread's messages (oldest first) record. The newest message that
 * holds one wins, so a corrected veto sent later replaces the first. Two forms
 * count:
 * - the veto bot's log; back-to-back log messages from one person are joined;
 * - with `shorthand` (the match's teams and map pool), a hand-typed veto such
 *   as "VP bans Lotus … Breeze remains (VP Atk)", which only counts when it is
 *   complete (see ./shorthand-veto.ts). It may span a few back-to-back
 *   messages from one person.
 * Chat around either is ignored. Null when the thread has no veto.
 */
export function latestVeto(
  messages: ThreadMessage[],
  shorthand?: ShorthandContext
): ThreadVeto | null {
  const logOf = (m: ThreadMessage) => extractVetoLogLines(messageLines(m))
  const authorOf = (m: ThreadMessage) => m.author?.id ?? null

  for (let newest = messages.length - 1; newest >= 0; newest--) {
    const authorId = authorOf(messages[newest]!)

    if (logOf(messages[newest]!).length > 0) {
      let first = newest
      while (first > 0) {
        const previous = messages[first - 1]!
        if (authorOf(previous) !== authorId || logOf(previous).length === 0) break
        first--
      }
      const seen = new Set<string>()
      const lines: string[] = []
      for (const message of messages.slice(first, newest + 1)) {
        for (const line of logOf(message)) {
          const key = line.toLowerCase()
          if (seen.has(key)) continue
          seen.add(key)
          lines.push(line)
        }
      }
      return { lines: normalizeVetoLines(lines), authorId }
    }

    if (!shorthand) continue
    // The shortest run of this person's messages, ending here, that is a whole veto.
    for (let first = newest; first >= 0 && first > newest - SHORTHAND_SPAN; first--) {
      const message = messages[first]!
      if (authorOf(message) !== authorId || logOf(message).length > 0) break
      const lines = messages.slice(first, newest + 1).flatMap(messageLines)
      const veto = parseShorthandVeto(lines, shorthand)
      if (veto) return { lines: veto, authorId }
    }
  }
  return null
}

export function sameLines(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined
) {
  const x = a ?? []
  const y = b ?? []
  return x.length === y.length && x.every((line, i) => line === y[i])
}

/**
 * What to do with the veto a thread holds now (`next`):
 * - `save`: the match has no veto yet, so the first log is saved as it is;
 * - `prompt`: it differs from the veto the bot saved, so ask before replacing it;
 * - `withdraw`: an open prompt no longer applies (the log was removed, put back
 *   as it was, or an admin has typed a veto on the site);
 * - `none`: nothing to do.
 * A veto an admin typed on the site is never replaced from Discord.
 */
export function planVeto(input: {
  /** The veto on the match now. */
  current: string[] | null | undefined
  /** What the bot last saved, to tell its own veto from one typed on the site. */
  lastImported: string[] | null | undefined
  /** The veto an open prompt offers. */
  pending: string[] | null | undefined
  /** A veto someone chose to keep out, so it isn't offered again. */
  dismissed: string[] | null | undefined
  next: string[]
}): 'save' | 'prompt' | 'withdraw' | 'none' {
  const { current, lastImported, pending, dismissed, next } = input
  const hasPending = (pending ?? []).length > 0
  const typedOnSite = (current ?? []).length > 0 && !sameLines(current, lastImported)

  if (typedOnSite) return hasPending ? 'withdraw' : 'none'
  if (next.length === 0 || sameLines(next, current)) return hasPending ? 'withdraw' : 'none'
  if ((current ?? []).length === 0) return 'save'
  if (sameLines(next, pending) || sameLines(next, dismissed)) return 'none'
  return 'prompt'
}

// ---------------------------------------------------------------------------
// Messages the bot posts in a thread

export type BotMessage = {
  content: string
  components?: unknown[]
  allowed_mentions: { parse: string[]; users?: string[]; roles?: string[] }
}

const NO_PINGS = { parse: [] as string[] }

function vetoList(lines: string[]): string {
  return lines.map((line, i) => `${i + 1}. ${line}`).join('\n')
}

/** Posted when a thread is linked from its title. */
export function linkedMessage(pairing: string, url: string): BotMessage {
  return {
    content:
      `🔗 This thread is linked to **${pairing}**: ${url}\n` +
      'Schedule updates will post here. Once the veto is done, paste its log here and it’s copied to the match.',
    allowed_mentions: NO_PINGS,
  }
}

/** Posted when a thread's first veto is saved onto the match. */
export function vetoSavedMessage(lines: string[], url: string): BotMessage {
  return {
    content: `✅ Veto saved to the match: ${url}\n${vetoList(lines)}`,
    allowed_mentions: NO_PINGS,
  }
}

/** A short fingerprint of a veto, so a button only applies to the veto it was shown with. */
export function vetoHash(lines: string[]): string {
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16)
}

/** Ids of the prompt's buttons: the action and a fingerprint of the veto offered. */
export function vetoButtonId(action: 'update' | 'keep', hash: string): string {
  return `veto:${action}:${hash}`
}

export function parseVetoButtonId(
  customId: string
): { action: 'update' | 'keep'; hash: string } | null {
  const match = /^veto:(update|keep):([0-9a-f]{1,64})$/.exec(customId)
  return match ? { action: match[1] as 'update' | 'keep', hash: match[2]! } : null
}

/**
 * Posted when a different veto log shows up after one was saved. Nothing
 * changes until someone presses a button, so a stray "yes" in chat can't
 * update it.
 */
export function vetoPromptMessage(
  lines: string[],
  authorId: string | null,
  hash: string
): BotMessage {
  const who = authorId ? `<@${authorId}>, a` : 'A'
  return {
    content:
      `${who} different veto log was posted. Replace the match’s saved veto with this one?\n` +
      `${vetoList(lines)}\n` +
      '-# The poster or staff can choose.',
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 3, label: 'Update veto', custom_id: vetoButtonId('update', hash) },
          { type: 2, style: 2, label: 'Keep current', custom_id: vetoButtonId('keep', hash) },
        ],
      },
    ],
    // Ping the poster so they see the question; no one else.
    allowed_mentions: { parse: [], users: authorId ? [authorId] : [] },
  }
}

/** What a prompt turns into once it's answered or no longer applies. */
export function vetoPromptClosed(
  outcome: 'updated' | 'kept' | 'withdrawn',
  userId: string | null,
  lines: string[] = []
): BotMessage {
  const by = userId ? ` by <@${userId}>` : ''
  const content =
    outcome === 'updated'
      ? `✅ Veto updated${by}:\n${vetoList(lines)}`
      : outcome === 'kept'
        ? `Kept the saved veto${by}.`
        : 'This veto prompt no longer applies, so the saved veto is unchanged.'
  return { content, components: [], allowed_mentions: NO_PINGS }
}

const MANAGE_THREADS = 1n << 34n
const MANAGE_EVENTS = 1n << 33n
const MANAGE_MESSAGES = 1n << 13n
const ADMINISTRATOR = 1n << 3n

type Member = { user?: { id?: string }; permissions?: string } | undefined

function hasAny(member: Member, bits: bigint): boolean {
  try {
    return (BigInt(member?.permissions ?? '0') & bits) !== 0n
  } catch {
    return false
  }
}

/** The poster of the log, or anyone with a staff permission, may answer its prompt. */
export function canAnswerVetoPrompt(member: Member, authorId: string | null): boolean {
  if (!member) return false
  if (authorId && member.user?.id === authorId) return true
  return hasAny(member, MANAGE_THREADS | MANAGE_MESSAGES | ADMINISTRATOR)
}

/** Staff for scheduling: Manage Threads, Manage Events or Administrator. */
export function canSetMatchTime(member: Member): boolean {
  return hasAny(member, MANAGE_THREADS | MANAGE_EVENTS | ADMINISTRATOR)
}

const CENTRAL = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/** "Sentinels vs Cloud9 · Tue, Nov 25, 7:00 PM CT", for the /link-match picker. */
export function matchChoiceLabel(match: ThreadMatch): string {
  const pairing = `${match.team_a?.name ?? 'TBD'} vs ${match.team_b?.name ?? 'TBD'}`
  const when = match.scheduled_at
    ? `${CENTRAL.format(new Date(match.scheduled_at))} CT`
    : 'not scheduled yet'
  const label = `${pairing} · ${when}`
  return label.length <= 100 ? label : `${label.slice(0, 99)}…`
}

/** Matches whose team names contain every word of `query`, for autocomplete. */
export function filterMatchChoices(matches: ThreadMatch[], query: string): ThreadMatch[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return matches
  return matches.filter((m) => {
    const text = `${m.team_a?.name ?? ''} ${m.team_b?.name ?? ''}`.toLowerCase()
    return words.every((word) => text.includes(word))
  })
}

// ---------------------------------------------------------------------------
// Threads the bot opens itself

/** How far ahead of its start time a match's thread is opened. */
export const THREAD_LEAD_MS = 7 * 24 * 60 * 60 * 1000

/** How long a deleted match's thread waits for a replacement before it closes. */
export const ORPHAN_GRACE_MS = 14 * 24 * 60 * 60 * 1000

/** A team as the thread messages need it: who to ping. */
export type PingTeam = { id: string; name: string; discord_role_id?: string | null }

export type NewThreadMatch = ThreadMatch & {
  best_of?: number | null
  created_at?: string | null
  /** Free text from the admin match editor, such as "Week 3". */
  designation?: string | null
  team_a: PingTeam | null
  team_b: PingTeam | null
}

/** The thread's name: the pairing, as the title linker reads it. */
export function threadTitle(match: Pick<ThreadMatch, 'team_a' | 'team_b'>): string {
  const title = `${match.team_a?.name ?? 'TBD'} vs ${match.team_b?.name ?? 'TBD'}`
  return title.length <= 100 ? title : `${title.slice(0, 99)}…`
}

/**
 * Whether it's time to open a match's thread: an open match between two real
 * teams that starts within a week. A match with no time yet opens when its
 * week starts (`weekOpensAt`), or straight away when its week isn't known,
 * since agreeing the time is what the thread is for.
 */
export function shouldOpenThread(
  match: ThreadMatch,
  now: Date,
  weekOpens: Date | null = null
): boolean {
  if (!OPEN_STATUSES.has(match.status ?? '')) return false
  if (!match.team_a || !match.team_b || match.team_a.id === match.team_b.id) return false
  if (!match.scheduled_at) return !weekOpens || now.getTime() >= weekOpens.getTime()
  const at = new Date(match.scheduled_at).getTime()
  const stale = now.getTime() - 24 * 60 * 60 * 1000
  return at >= stale && at <= now.getTime() + THREAD_LEAD_MS
}

/** "Week 3", "wk 3", "W3": the regular-season week a designation names. */
export function designationWeek(designation: string | null | undefined): number | null {
  const found = /\b(?:week|wk|w)\s*(\d{1,2})\b/i.exec(designation ?? '')
  const week = found ? Number(found[1]) : NaN
  return Number.isInteger(week) && week >= 1 ? week : null
}

/**
 * The first day of regular-season week `week`, as `YYYY-MM-DD`. Week 1 starts
 * on the stage's start date; each week closes on `weekEndDay` (0 = Sunday),
 * the same count as `regularSeasonWeek` in $lib/seasons/schedule.
 */
export function weekStartDate(startsOn: string, weekEndDay: number, week: number): string {
  if (week <= 1) return startsOn
  const start = Date.parse(`${startsOn}T00:00:00Z`)
  const toFirstEnd = (weekEndDay - new Date(start).getUTCDay() + 7) % 7
  const day = start + (toFirstEnd + 1 + 7 * (week - 2)) * 86_400_000
  return new Date(day).toISOString().slice(0, 10)
}

export type OrphanThread = {
  threadId: string
  teamIds: string[]
  orphanedAt: string
}

/**
 * The deleted match's thread a new match takes over: one that shared a team
 * with it, orphaned before the new match was created (a replacement is made
 * after the old one goes, so a team's other, older fixtures never take it)
 * and not long ago. The same pairing beats a shared team; then the newest.
 */
export function pickOrphanThread(
  match: NewThreadMatch,
  orphans: OrphanThread[],
  now: Date
): OrphanThread | null {
  const ids = new Set([match.team_a?.id, match.team_b?.id].filter(Boolean) as string[])
  const created = match.created_at ? new Date(match.created_at).getTime() : null
  if (created == null) return null
  const scored = orphans
    .map((orphan) => ({
      orphan,
      shared: orphan.teamIds.filter((id) => ids.has(id)).length,
      at: new Date(orphan.orphanedAt).getTime(),
    }))
    .filter(
      ({ shared, at }) => shared > 0 && at <= created && now.getTime() - at <= ORPHAN_GRACE_MS
    )
  scored.sort((a, b) => b.shared - a.shared || b.at - a.at)
  return scored[0]?.orphan ?? null
}

/** `<@&role>`, or the team's name in bold when it has no role yet. */
function teamMention(team: PingTeam | null): string {
  if (!team) return '**TBD**'
  return team.discord_role_id ? `<@&${team.discord_role_id}>` : `**${team.name}**`
}

function rolePings(teams: Array<PingTeam | null>): { parse: string[]; roles: string[] } {
  const roles = teams
    .map((t) => t?.discord_role_id)
    .filter((id): id is string => typeof id === 'string' && /^\d+$/.test(id))
  return { parse: [], roles: [...new Set(roles)] }
}

/** The message a thread the bot opens starts with: both teams pinged, and what to do here. */
export function threadOpeningMessage(
  match: NewThreadMatch,
  url: string,
  mapPool: string[] | null
): BotMessage {
  const lines = [
    `${teamMention(match.team_a)} vs ${teamMention(match.team_b)}`,
    `This is your thread for **${threadTitle(match)}** (Bo${match.best_of ?? 3}): ${url}`,
    '',
    '1. Agree a match time here, then propose it with `/set-time`. Staff approve it.',
    '2. Run the map veto and post the log here (or type it out, e.g. “VP bans Lotus …”). It’s copied to the match.',
  ]
  if (mapPool && mapPool.length > 0) lines.push('', `-# Map pool: ${mapPool.join(', ')}`)
  return { content: lines.join('\n'), allowed_mentions: rolePings([match.team_a, match.team_b]) }
}

/**
 * Posted when the thread's match changes hands: the match was edited to a new
 * opponent, or a replacement match took the thread over. Pings both current
 * teams; an earlier veto no longer counts.
 */
export function opponentChangedMessage(
  removed: string[],
  match: NewThreadMatch,
  url: string
): BotMessage {
  const added = [match.team_a, match.team_b]
  const was = removed.length > 0 ? ` (replacing **${removed.join('** and **')}**)` : ''
  return {
    content:
      `🔁 Opponent change${was}. This thread is now for **${threadTitle(match)}**: ${url}\n` +
      `${teamMention(added[0] ?? null)} ${teamMention(added[1] ?? null)}, ` +
      'a veto from before this no longer counts, so please redo it here and confirm the match time.',
    allowed_mentions: rolePings(added),
  }
}

/** Posted when the thread's match is deleted from the site. */
export function matchRemovedMessage(): BotMessage {
  return {
    content:
      '⚠️ This match was removed from the schedule. If a replacement match is set up, it continues in this thread; ' +
      'otherwise the thread closes in two weeks.',
    allowed_mentions: NO_PINGS,
  }
}

/** "Sentinels 2–1 Cloud9", for the closing note; null without a score. */
export function resultLine(match: {
  team_a: { name: string } | null
  team_b: { name: string } | null
  team_a_score?: number | null
  team_b_score?: number | null
}): string | null {
  const a = match.team_a_score
  const b = match.team_b_score
  if (a == null || b == null || (a === 0 && b === 0)) return null
  return `${match.team_a?.name ?? 'TBD'} ${a}–${b} ${match.team_b?.name ?? 'TBD'}`
}

/** Posted as the bot locks a finished match's thread. */
export function threadClosedMessage(
  reason: 'completed' | 'cancelled' | 'removed',
  url: string | null,
  result: string | null = null
): BotMessage {
  const content =
    reason === 'completed'
      ? `🔒 Match complete${result ? `: **${result}**` : ''}${
          url
            ? `
${url}`
            : ''
        }
Closing this thread.`
      : reason === 'cancelled'
        ? `🔒 This match was cancelled${url ? `: ${url}` : ''}. Closing this thread.`
        : '🔒 No replacement match was set up, so this thread is closed.'
  return { content, allowed_mentions: NO_PINGS }
}

/**
 * Whether a thread's match is over, so the thread closes: as soon as its
 * result is in (imported or entered) or it's cancelled.
 */
export function threadCloseReason(
  match: { status: string | null } | null
): 'completed' | 'cancelled' | null {
  if (match?.status === 'cancelled') return 'cancelled'
  if (match?.status === 'completed') return 'completed'
  return null
}

/** Messages after `sinceId` (Discord ids grow over time); all of them without one. */
export function messagesSince<T extends { id: string }>(
  messages: T[],
  sinceId: string | null
): T[] {
  if (!sinceId) return messages
  try {
    const since = BigInt(sinceId)
    return messages.filter((m) => BigInt(m.id) > since)
  } catch {
    return messages
  }
}

// ---------------------------------------------------------------------------
// Time proposals: /set-time from someone who isn't staff

/** Ids of a proposal's buttons: the action, the match, and the proposed start (unix seconds). */
export function timeButtonId(action: 'approve' | 'reject', matchId: string, unix: number): string {
  return `time:${action}:${matchId}:${unix}`
}

export function parseTimeButtonId(
  customId: string
): { action: 'approve' | 'reject'; matchId: string; unix: number } | null {
  const found = /^time:(approve|reject):([0-9a-f-]{36}):(\d{9,11})$/i.exec(customId)
  if (!found) return null
  return { action: found[1] as 'approve' | 'reject', matchId: found[2]!, unix: Number(found[3]) }
}

/**
 * Posted when a player proposes a time. Nothing changes until staff press
 * Approve; the proposer is named but not pinged (they just ran the command).
 */
export function timeProposalMessage(
  pairing: string,
  matchId: string,
  unix: number,
  proposerId: string | null
): BotMessage {
  const who = proposerId ? `<@${proposerId}>` : 'Someone'
  return {
    content:
      `🕒 ${who} proposed **<t:${unix}:F>** (<t:${unix}:R>) for **${pairing}**.\n` +
      '-# Staff (Manage Threads, Manage Events or Administrator) can approve it.',
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: 'Approve',
            custom_id: timeButtonId('approve', matchId, unix),
          },
          { type: 2, style: 4, label: 'Reject', custom_id: timeButtonId('reject', matchId, unix) },
        ],
      },
    ],
    allowed_mentions: NO_PINGS,
  }
}

/** What a proposal turns into once staff answer it, or once it can't apply. */
export function timeProposalClosed(
  outcome: 'approved' | 'rejected' | 'stale',
  unix: number,
  pairing: string,
  userId: string | null,
  detail?: string
): BotMessage {
  const by = userId ? ` by <@${userId}>` : ''
  const content =
    outcome === 'approved'
      ? `✅ **${pairing}** is set for <t:${unix}:F> (<t:${unix}:R>), approved${by}.\n` +
        'The match page, the Discord event and the schedule post are updated.'
      : outcome === 'rejected'
        ? `❌ The proposed time <t:${unix}:F> for **${pairing}** was rejected${by}. Propose another with \`/set-time\`.`
        : `This proposal for <t:${unix}:F> no longer applies${detail ? `: ${detail}` : ''}.`
  return { content, components: [], allowed_mentions: NO_PINGS }
}
