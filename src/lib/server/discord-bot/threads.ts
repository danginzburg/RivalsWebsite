import { extractVetoLogLines, normalizeVetoLines } from '$lib/matches/vetoLog'

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

/**
 * The veto a thread's messages (oldest first) record, as the match page stores
 * it. Log lines can arrive in one paste or across several messages; a log
 * pasted twice counts once, since its timestamped lines repeat exactly.
 * Chat between the lines is ignored. Empty when the thread has no log.
 */
export function vetoFromMessages(messages: ThreadMessage[]): string[] {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const message of messages) {
    for (const line of extractVetoLogLines(messageLines(message))) {
      const key = line.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      lines.push(line)
    }
  }
  return lines.length > 0 ? normalizeVetoLines(lines) : []
}

function sameLines(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined
) {
  const x = a ?? []
  const y = b ?? []
  return x.length === y.length && x.every((line, i) => line === y[i])
}

/**
 * Whether to write the thread's veto onto the match. A veto an admin typed on
 * the site (anything other than what the bot last imported) is never
 * overwritten.
 */
export function shouldSaveVeto(input: {
  current: string[] | null | undefined
  lastImported: string[] | null | undefined
  next: string[]
}): boolean {
  const { current, lastImported, next } = input
  if (next.length === 0 || sameLines(current, next)) return false
  const untouched = (current ?? []).length === 0 || sameLines(current, lastImported)
  return untouched
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
