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
  allowed_mentions: { parse: string[]; users?: string[] }
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
