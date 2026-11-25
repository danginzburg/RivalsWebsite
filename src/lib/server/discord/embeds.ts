import { LEAGUE_TIME_ZONE, SITE_NAME } from '$lib/meta'
import type { DiscordEmbed, WebhookPayload } from './webhook'
import { sortRoster, type RosterChange, type RosterEntry, type RosterRole } from './roster-diff'

/*
 * Pure builders for every automatic Discord post. They take plain data
 * (loaded elsewhere) and return a webhook payload, so they can be tested
 * without a database or Discord.
 */

export const COLORS = {
  brand: 0xff4655,
  schedule: 0x3b82f6,
  result: 0x22c55e,
  cancelled: 0x6b7280,
  live: 0x9146ff,
  stream: 0xf59e0b,
  pickem: 0xeab308,
  admin: 0xef4444,
} as const

export type TeamRef = { name: string; tag: string | null }

/** Fields every match post shares. */
export type MatchRef = {
  matchId: string
  /** Absolute site origin, e.g. https://tcrivals.gg (no trailing slash). */
  siteUrl: string
  teamA: TeamRef
  teamB: TeamRef
  /** "Season 5 · Play-ins R2", or null. */
  event: string | null
  scheduledAt: string | null
  bestOf?: number | null
}

// ── Formatting helpers ──────────────────────────────────────────────────────

/** Discord renders `<t:UNIX:F>` in each reader's own time zone. */
export function discordTimestamp(
  iso: string | null | undefined,
  style: 'F' | 'R' | 'f' | 't' | 'D' = 'F'
): string | null {
  if (!iso) return null
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return null
  return `<t:${Math.floor(ms / 1000)}:${style}>`
}

/** "Full date (in 3 hours)". */
function whenLine(iso: string | null | undefined): string | null {
  const full = discordTimestamp(iso, 'F')
  return full ? `${full} (${discordTimestamp(iso, 'R')})` : null
}

export function matchUrl(match: Pick<MatchRef, 'siteUrl' | 'matchId'>): string {
  return `${match.siteUrl}/matches/${match.matchId}`
}

/** Markdown-safe text: team and player names are user input. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_~`|>[\]])/g, '\\$1')
}

function teamLabel(team: TeamRef): string {
  const name = escapeMarkdown(team.name || 'TBD')
  return team.tag ? `${name} (${escapeMarkdown(team.tag)})` : name
}

function versus(match: MatchRef): string {
  return `${teamLabel(match.teamA)} vs ${teamLabel(match.teamB)}`
}

/** Plain title text (embed titles don't render markdown, so nothing is escaped). */
function versusTitle(match: MatchRef): string {
  return `${match.teamA.name || 'TBD'} vs ${match.teamB.name || 'TBD'}`
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function footer(match: Pick<MatchRef, 'event'>): { text: string } {
  return { text: match.event ? `${SITE_NAME} · ${match.event}` : SITE_NAME }
}

function payload(embed: DiscordEmbed, content?: string, roles?: string[]): WebhookPayload {
  return {
    ...(content ? { content } : {}),
    embeds: [embed],
    allowed_mentions: roles && roles.length > 0 ? { parse: [], roles } : { parse: [] },
  }
}

/** Ping a role above the post (Discord only notifies on the first send, not on edits). */
export function withRolePing(p: WebhookPayload, roleId: string | null | undefined): WebhookPayload {
  if (!roleId) return p
  const mention = `<@&${roleId}>`
  const content = p.content?.includes(mention)
    ? p.content
    : [mention, p.content].filter(Boolean).join(' ')
  const roles = [...new Set([...(p.allowed_mentions?.roles ?? []), roleId])]
  // Keep any user pings already allowed (withUserPings).
  return { ...p, content, allowed_mentions: { ...p.allowed_mentions, parse: [], roles } }
}

/** Discord ignores user mentions past this many in allowed_mentions. */
const MAX_USER_MENTIONS = 100

/**
 * Mention these Discord users above the post, and allow exactly them to be
 * pinged (Discord only notifies on the first send, not on edits).
 */
export function withUserPings(p: WebhookPayload, userIds: readonly string[]): WebhookPayload {
  const ids = [...new Set(userIds.filter((id) => /^\d+$/.test(id)))].slice(0, MAX_USER_MENTIONS)
  if (ids.length === 0) return p
  const mentions = ids.map((id) => `<@${id}>`).join(' ')
  return {
    ...p,
    content: [p.content, mentions].filter(Boolean).join('\n'),
    allowed_mentions: { ...p.allowed_mentions, parse: [], users: ids },
  }
}

// ── Match scheduling (posted into the match's forum thread) ─────────────────

export function matchScheduledPayload(match: MatchRef & { rescheduled?: boolean }): WebhookPayload {
  const when = whenLine(match.scheduledAt)
  return payload({
    title: `${match.rescheduled ? 'Rescheduled' : 'Scheduled'}: ${versusTitle(match)}`,
    url: matchUrl(match),
    color: COLORS.schedule,
    description: [versus(match), when ?? 'Time to be decided'].join('\n'),
    fields: match.bestOf
      ? [{ name: 'Format', value: `Best of ${match.bestOf}`, inline: true }]
      : undefined,
    footer: footer(match),
  })
}

/** The morning-of reminder: "you play today". */
export function matchReminderPayload(match: MatchRef): WebhookPayload {
  const time = discordTimestamp(match.scheduledAt, 't')
  return payload({
    title: `Match day: ${versusTitle(match)}`,
    url: matchUrl(match),
    color: COLORS.schedule,
    description: [
      versus(match),
      time ? `You play today at ${time} (${discordTimestamp(match.scheduledAt, 'R')}).` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    footer: footer(match),
  })
}

export function matchCancelledPayload(match: MatchRef): WebhookPayload {
  const was = discordTimestamp(match.scheduledAt, 'F')
  return payload({
    title: `Cancelled: ${versusTitle(match)}`,
    url: matchUrl(match),
    color: COLORS.cancelled,
    description: [
      versus(match),
      was ? `Was scheduled for ${was}.` : null,
      'This match has been cancelled.',
    ]
      .filter(Boolean)
      .join('\n'),
    footer: footer(match),
  })
}

// ── Results ─────────────────────────────────────────────────────────────────

export type ResultSide = 'a' | 'b'

export type ResultMap = {
  /** Null for a forfeited map that was never played. */
  name: string | null
  a: number
  b: number
  /** Set when the map was forfeited: which side conceded it, and an admin note. */
  forfeit?: { by: ResultSide | null; label?: string | null } | null
}

/**
 * The whole match was decided by forfeit: a no-show, or an admin awarding the
 * series against the map score.
 */
export type ResultForfeit = {
  kind: 'no_show' | 'admin_award'
  by: ResultSide | null
  reason?: string | null
}

export type MatchResultInput = MatchRef & {
  scoreA: number
  scoreB: number
  winner: ResultSide | null
  maps: ResultMap[]
  mvp: { name: string; acs: number | null; agent?: string | null } | null
  forfeit?: ResultForfeit | null
  /** Changes when the result does, so Discord refetches the card after a correction. */
  cardVersion?: string
}

function mapField(match: MatchResultInput, map: ResultMap, index: number) {
  const score = `${map.a} – ${map.b}`
  if (!map.forfeit) {
    return { name: `Map ${index + 1} · ${map.name ?? 'Unknown'}`, value: score, inline: true }
  }
  const by = map.forfeit.by ? (map.forfeit.by === 'a' ? match.teamA : match.teamB) : null
  const note = [
    by ? `FF by ${escapeMarkdown(by.tag || by.name || 'TBD')}` : 'FF',
    map.forfeit.label ? escapeMarkdown(truncate(map.forfeit.label, 80)) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return {
    name: `Map ${index + 1} · ${map.name ?? 'Forfeit'}`,
    value: `${score} (${note})`,
    inline: true,
  }
}

/** "Project 30 forfeited (no-show)." plus the admin's reason. */
function forfeitLine(match: MatchResultInput, forfeit: ResultForfeit): string {
  const team = forfeit.by === 'a' ? match.teamA : forfeit.by === 'b' ? match.teamB : null
  const who = team ? escapeMarkdown(team.name || 'TBD') : 'A team'
  const what =
    forfeit.kind === 'no_show'
      ? `${who} forfeited (no-show).`
      : `${who} forfeited; the win was awarded by admins.`
  const reason = forfeit.reason?.trim()
  return reason ? `${what}\nReason: ${escapeMarkdown(truncate(reason, 500))}` : what
}

export function matchResultPayload(match: MatchResultInput): WebhookPayload {
  const nameA = escapeMarkdown(match.teamA.name || 'TBD')
  const nameB = escapeMarkdown(match.teamB.name || 'TBD')
  const scoreLine =
    match.winner === 'a'
      ? `**${nameA} ${match.scoreA}** – ${match.scoreB} ${nameB}`
      : match.winner === 'b'
        ? `${nameA} ${match.scoreA} – **${match.scoreB} ${nameB}**`
        : `${nameA} ${match.scoreA} – ${match.scoreB} ${nameB}`

  const fields: NonNullable<DiscordEmbed['fields']> = match.maps
    .slice(0, 7)
    .map((map, i) => mapField(match, map, i))
  if (match.mvp) {
    const details = [
      match.mvp.agent,
      match.mvp.acs != null ? `${Math.round(match.mvp.acs)} ACS` : null,
    ]
      .filter(Boolean)
      .join(' · ')
    fields.push({
      name: 'MVP',
      value: `${escapeMarkdown(match.mvp.name)}${details ? ` (${details})` : ''}`,
      inline: false,
    })
  }

  const version = match.cardVersion ? `?v=${encodeURIComponent(match.cardVersion)}` : ''
  const winnerName =
    match.winner === 'a' ? match.teamA.name : match.winner === 'b' ? match.teamB.name : null
  const winnerScore = match.winner === 'a' ? match.scoreA : match.scoreB
  const loserScore = match.winner === 'a' ? match.scoreB : match.scoreA
  // An admin award can go against the map score, so "win 1–2" would read wrong.
  const title = !winnerName
    ? `Final: ${versusTitle(match)}`
    : match.forfeit
      ? `${winnerName} win by forfeit`
      : `${winnerName} win ${winnerScore}–${loserScore}`
  return payload({
    title,
    url: matchUrl(match),
    color: COLORS.result,
    description: match.forfeit ? `${scoreLine}\n${forfeitLine(match, match.forfeit)}` : scoreLine,
    fields: fields.length > 0 ? fields : undefined,
    image: { url: `${match.siteUrl}/og/match/${match.matchId}.png${version}` },
    footer: footer(match),
    timestamp: match.scheduledAt ?? undefined,
  })
}

// ── VODs (plain text in the #vods house format) ─────────────────────────────

/**
 * "Play-ins R2" from the stage label and the match designation, without
 * repeating the stage when the designation already names it.
 */
export function vodStageLine(stageLabel: string | null, designation: string | null): string | null {
  const stage = stageLabel?.trim() || null
  const label = designation?.trim() || null
  if (!label) return stage
  if (!stage) return label
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  return normalize(label).startsWith(normalize(stage)) ? label : `${stage} ${label}`
}

/** Minutes the league time zone is ahead of UTC at `at` (negative for Central). */
function leagueOffsetMinutes(at: Date): number {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone: LEAGUE_TIME_ZONE, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name)
  if (!match) return 0
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0)
  return match[1] === '-' ? -minutes : minutes
}

/** The next midnight on league (Central) time: the end of "today" for match-day reminders. */
export function leagueDayEnd(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: LEAGUE_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  const midnightAsUtc = Date.UTC(get('year'), get('month') - 1, get('day') + 1)
  return new Date(midnightAsUtc - leagueOffsetMinutes(new Date(midnightAsUtc)) * 60_000)
}

/** Day of the week on league (Central) time: 0 = Sunday … 6 = Saturday. */
export function leagueWeekday(now: Date = new Date()): number {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: LEAGUE_TIME_ZONE,
    weekday: 'short',
  }).format(now)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(day)
}

/** MM/DD/YYYY on league (Central) time. */
export function leagueDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return null
  return date.toLocaleDateString('en-US', {
    timeZone: LEAGUE_TIME_ZONE,
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  })
}

/**
 * JRB vs P30
 * Play-ins R2
 * 05/07/2026
 * https://www.youtube.com/watch?v=…
 */
export function vodPayload(input: {
  teamA: TeamRef
  teamB: TeamRef
  stageLine: string | null
  scheduledAt: string | null
  vodUrl: string
}): WebhookPayload {
  const short = (t: TeamRef) => t.tag || t.name || 'TBD'
  const lines = [
    `${short(input.teamA)} vs ${short(input.teamB)}`,
    input.stageLine,
    leagueDate(input.scheduledAt),
    input.vodUrl,
  ].filter((line): line is string => Boolean(line))
  // Plain text: Discord unfurls the YouTube link itself.
  return { content: lines.join('\n'), allowed_mentions: { parse: [] } }
}

// ── Streams ─────────────────────────────────────────────────────────────────

export type StreamInput = MatchRef & {
  platform: string
  streamUrl: string
  displayName: string | null
}

const PLATFORM_LABELS: Record<string, string> = {
  twitch: 'Twitch',
  youtube: 'YouTube',
  kick: 'Kick',
}

function streamer(stream: StreamInput): string {
  const platform = PLATFORM_LABELS[stream.platform] ?? 'Stream'
  return stream.displayName ? `${escapeMarkdown(stream.displayName)} on ${platform}` : platform
}

/** #prod-announcements: a stream link was attached to a match. */
export function streamAddedPayload(stream: StreamInput): WebhookPayload {
  const when = whenLine(stream.scheduledAt)
  return payload({
    title: `Stream added: ${versusTitle(stream)}`,
    url: stream.streamUrl,
    color: COLORS.stream,
    description: [
      versus(stream),
      when,
      `Streamed by ${streamer(stream)}: ${stream.streamUrl}`,
      `Match page: ${matchUrl(stream)}`,
    ]
      .filter(Boolean)
      .join('\n'),
    footer: footer(stream),
  })
}

/** #official-streams: the stream is live; pings the stream role when one is configured. */
export function streamLivePayload(stream: StreamInput, pingRoleId?: string | null): WebhookPayload {
  const ping = pingRoleId ? `<@&${pingRoleId}> ` : ''
  return payload(
    {
      title: `LIVE: ${versusTitle(stream)}`,
      url: stream.streamUrl,
      color: COLORS.live,
      description: [versus(stream), `Watch ${streamer(stream)}: ${stream.streamUrl}`].join('\n'),
      footer: footer(stream),
    },
    `${ping}${versusTitle(stream)} is live! ${stream.streamUrl}`,
    pingRoleId ? [pingRoleId] : undefined
  )
}

/** The live post after the stream ends: no ping, marked as over. */
export function streamEndedPayload(stream: StreamInput): WebhookPayload {
  return payload(
    {
      title: `Ended: ${versusTitle(stream)}`,
      url: stream.streamUrl,
      color: COLORS.cancelled,
      description: [versus(stream), `The stream has ended. ${stream.streamUrl}`].join('\n'),
      footer: footer(stream),
    },
    `${versusTitle(stream)} stream has ended.`
  )
}

// ── Teams ───────────────────────────────────────────────────────────────────

export function teamLogoPayload(team: {
  name: string
  tag: string | null
  logoUrl: string | null
  seasonName: string | null
  teamUrl: string | null
}): WebhookPayload {
  return payload({
    title: team.tag ? `${team.name} [${team.tag}]` : team.name,
    url: team.teamUrl ?? undefined,
    color: COLORS.brand,
    fields: [
      { name: 'Team', value: escapeMarkdown(team.name), inline: true },
      { name: 'Tag', value: team.tag ? escapeMarkdown(team.tag) : '—', inline: true },
    ],
    image: team.logoUrl ? { url: team.logoUrl } : undefined,
    footer: { text: team.seasonName ? `${SITE_NAME} · ${team.seasonName}` : SITE_NAME },
  })
}

// ── Team rosters ────────────────────────────────────────────────────────────

export type RosterTeam = {
  name: string
  tag: string | null
  logoUrl: string | null
  seasonName: string | null
  teamUrl: string
}

export type RosterHistoryEntry = { at: string; changes: RosterChange[] }

const ROLE_LABEL: Record<RosterRole, string> = {
  captain: 'Captain',
  player: 'Player',
  substitute: 'Sub',
  coach: 'Coach',
  manager: 'Manager',
}

/** Embed field values are capped at 1024 characters. */
const FIELD_MAX = 1024

function teamTitle(team: RosterTeam): string {
  return team.tag ? `${team.name} [${team.tag}]` : team.name
}

function teamFooter(team: RosterTeam): { text: string } {
  return { text: team.seasonName ? `${SITE_NAME} · ${team.seasonName}` : SITE_NAME }
}

/** "• **Name** joined as Sub" and friends, one per change. */
export function rosterChangeLine(change: RosterChange): string {
  const name = `**${escapeMarkdown(change.name)}**`
  switch (change.type) {
    case 'added':
      return change.role === 'player'
        ? `• ${name} joined`
        : `• ${name} joined as ${ROLE_LABEL[change.role]}`
    case 'removed':
      return `• ${name} left`
    case 'role':
      return `• ${name}: ${ROLE_LABEL[change.from]} → ${ROLE_LABEL[change.to]}`
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * The roster as full-width sections, one under another: Players (captain
 * first, crowned), Substitutes, Staff (coaches and managers, labeled).
 */
function rosterFields(roster: RosterEntry[]): Array<{ name: string; value: string }> {
  const sorted = sortRoster(roster)
  const of = (...roles: RosterRole[]) => sorted.filter((e) => roles.includes(e.role))
  const name = (e: RosterEntry) => escapeMarkdown(e.name)

  const players = of('captain', 'player').map((e) =>
    e.role === 'captain' ? `• **${name(e)}** · *Captain*` : `• ${name(e)}`
  )
  const subs = of('substitute').map((e) => `• ${name(e)}`)
  const staff = of('coach', 'manager').map((e) => `• ${name(e)} · *${ROLE_LABEL[e.role]}*`)

  const sections = [
    { name: 'Players', lines: players },
    { name: 'Substitutes', lines: subs },
    { name: 'Staff', lines: staff },
  ].filter((s) => s.lines.length > 0)
  if (sections.length === 0) return [{ name: 'Players', value: '*No players yet*' }]
  return sections.map((s) => ({ name: s.name, value: truncate(s.lines.join('\n'), FIELD_MAX) }))
}

/** "5 players · 1 sub · 1 staff", for the line under the title. */
function rosterSummary(roster: RosterEntry[]): string {
  const count = (...roles: RosterRole[]) => roster.filter((e) => roles.includes(e.role)).length
  const parts = [
    plural(count('captain', 'player'), 'player', 'players'),
    count('substitute') > 0 ? plural(count('substitute'), 'sub', 'subs') : null,
    count('coach', 'manager') > 0 ? `${count('coach', 'manager')} staff` : null,
  ]
  return parts.filter(Boolean).join(' · ')
}

/**
 * Newest-last history, one block per published update (its date, then one
 * change per line), keeping as many recent blocks as fit in a field and
 * noting how many earlier ones were left out.
 */
export function rosterHistoryValue(history: RosterHistoryEntry[], teamUrl: string): string | null {
  const lines = history
    .filter((h) => h.changes.length > 0)
    .map((h) => {
      const date = discordTimestamp(h.at, 'D')
      return [date ? `**${date}**` : null, ...h.changes.map(rosterChangeLine)]
        .filter(Boolean)
        .join('\n')
    })
  if (lines.length === 0) return null

  const note = (omitted: number) =>
    `+ ${omitted} earlier update${omitted === 1 ? '' : 's'} · [team page](${teamUrl})`
  // Room for the note however many are left out, so adding it never overflows.
  const budget = FIELD_MAX - note(lines.length).length - 1
  const kept: string[] = []
  let length = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = truncate(lines[i], budget)
    if (kept.length > 0 && length + line.length + 1 > budget) {
      return [note(i + 1), ...kept].join('\n')
    }
    kept.unshift(line)
    length += line.length + 1
  }
  return kept.join('\n')
}

/** #team-creation: the team with its current roster and its published change history. */
export function teamRosterPayload(
  team: RosterTeam,
  roster: RosterEntry[],
  history: RosterHistoryEntry[]
): WebhookPayload {
  const historyValue = rosterHistoryValue(history, team.teamUrl)
  return payload({
    title: teamTitle(team),
    url: team.teamUrl,
    color: COLORS.brand,
    description: roster.length > 0 ? rosterSummary(roster) : undefined,
    thumbnail: team.logoUrl ? { url: team.logoUrl } : undefined,
    fields: [
      ...rosterFields(roster),
      ...(historyValue ? [{ name: 'Change history', value: historyValue }] : []),
    ],
    footer: teamFooter(team),
  })
}

/** #team-updates: one published batch of roster changes. */
export function teamUpdatePayload(
  team: RosterTeam,
  changes: RosterChange[],
  publishedAt: string
): WebhookPayload {
  return payload({
    title: `${teamTitle(team)} roster update`,
    url: team.teamUrl,
    color: COLORS.schedule,
    description: truncate(changes.map(rosterChangeLine).join('\n'), 4000),
    thumbnail: team.logoUrl ? { url: team.logoUrl } : undefined,
    footer: teamFooter(team),
    timestamp: publishedAt,
  })
}

// ── Pick'ems ────────────────────────────────────────────────────────────────

export type PickemRef = {
  siteUrl: string
  seasonCode: string
  /** "Season 5 Pick'em" or the event's own title. */
  title: string
  lockAt: string | null
}

function pickemUrl(p: PickemRef): string {
  return `${p.siteUrl}/pickems/${p.seasonCode}`
}

export function pickemOpenedPayload(p: PickemRef): WebhookPayload {
  const lock = whenLine(p.lockAt)
  return payload({
    title: `${p.title} is open`,
    url: pickemUrl(p),
    color: COLORS.pickem,
    description: [
      lock ? `Picks lock ${lock}.` : 'Get your picks in before it locks.',
      `Make your picks: ${pickemUrl(p)}`,
    ].join('\n'),
  })
}

export function pickemLockWarningPayload(p: PickemRef): WebhookPayload {
  const time = discordTimestamp(p.lockAt, 't')
  return payload({
    title: `${p.title} locks today`,
    url: pickemUrl(p),
    color: COLORS.pickem,
    description: [
      time
        ? `Picks lock today at ${time} (${discordTimestamp(p.lockAt, 'R')}). Last chance!`
        : 'Picks lock today. Last chance!',
      pickemUrl(p),
    ].join('\n'),
  })
}

export function pickemLockedPayload(p: PickemRef): WebhookPayload {
  return payload({
    title: `${p.title} is locked`,
    url: pickemUrl(p),
    color: COLORS.pickem,
    description: `Picks are in. Follow the standings as results come in: ${pickemUrl(p)}`,
  })
}

/**
 * The pick'em is final ("Final now" on the site): the winner, or everyone tied
 * for first, the top of the leaderboard, and the standings card as the image.
 */
export function pickemFinalPayload(
  p: PickemRef & {
    board: Array<{ name: string; score: number; rank: number }>
    imageUrl?: string | null
  }
): WebhookPayload {
  const winners = p.board.filter((e) => e.rank === 1)
  const medals = ['🥇', '🥈', '🥉']
  const lines = p.board.map(
    (e) => `${medals[e.rank - 1] ?? `**${e.rank}.**`} ${escapeMarkdown(e.name)} · ${e.score} pts`
  )
  const names = winners.map((w) => w.name).join(' & ')
  return payload({
    title:
      winners.length > 0
        ? `${names} ${winners.length > 1 ? 'win' : 'wins'} the ${p.title}!`
        : `${p.title} is final`,
    url: pickemUrl(p),
    color: COLORS.pickem,
    description: [...lines, '', `Full leaderboard: ${pickemUrl(p)}`].join('\n'),
    image: p.imageUrl ? { url: p.imageUrl } : undefined,
  })
}

// ── Weekly standings (#rivals-annoucements) ─────────────────────────────────

export type WeeklyStandingsRow = {
  rank: number
  name: string
  tag: string | null
  wins: number
  losses: number
  mapWins: number
  mapLosses: number
  roundDiff: number
  /**
   * Places gained (+) or lost (-) since a week ago; 0 for no change. Null for a
   * team that had not played a series a week ago.
   */
  move: number | null
}

/** Teams listed in the post; the rest are on the site. */
export const WEEKLY_STANDINGS_SHOWN = 16

function moveLabel(move: number | null): string {
  if (move === null) return ' · 🆕'
  if (move > 0) return ` · ▲${move}`
  if (move < 0) return ` · ▼${-move}`
  return ''
}

/**
 * The Monday standings post: every team's rank, series record, map record and
 * round difference, with its movement over the week, and the standings card.
 */
export function weeklyStandingsPayload(input: {
  siteUrl: string
  season: string
  rows: WeeklyStandingsRow[]
  /** Standings series played over the past week. */
  seriesThisWeek: number
  imageUrl?: string | null
}): WebhookPayload {
  const url = `${input.siteUrl}/leaderboard`
  const shown = input.rows.slice(0, WEEKLY_STANDINGS_SHOWN)
  const lines = shown.map((r) => {
    const rd = r.roundDiff > 0 ? `+${r.roundDiff}` : String(r.roundDiff)
    return (
      `**${r.rank}.** ${teamLabel(r)} · ${r.wins}-${r.losses}` +
      ` · maps ${r.mapWins}-${r.mapLosses} · RD ${rd}${moveLabel(r.move)}`
    )
  })
  const more = input.rows.length - shown.length
  if (more > 0) lines.push(`…and ${more} more`)

  // The biggest climb of the week, when someone moved up.
  const climber = [...input.rows]
    .filter((r) => (r.move ?? 0) > 0)
    .sort((a, b) => (b.move ?? 0) - (a.move ?? 0) || a.rank - b.rank)[0]
  const series = `${input.seriesThisWeek} series played this week.`
  const intro = climber
    ? `${series} Biggest climb: ${teamLabel(climber)}, up ${climber.move} to #${climber.rank}.`
    : series

  return payload({
    title: `${input.season} standings`,
    url,
    color: COLORS.brand,
    description: truncate([intro, '', ...lines, '', `Full standings: ${url}`].join('\n'), 4096),
    image: input.imageUrl ? { url: input.imageUrl } : undefined,
    footer: { text: `${SITE_NAME} · Weekly standings` },
  })
}

// ── Admin alerts (private staff channel) ────────────────────────────────────

export type AdminAlert =
  | { kind: 'bug_report'; reporter: string | null; pagePath: string | null; description: string }
  | {
      kind: 'match_report'
      submitter: string | null
      /** "Team A vs Team B"; filled in from the match when null. */
      matchLabel: string | null
      matchId: string
      reasons: string[]
    }
  | {
      kind: 'comment_report'
      reporter: string | null
      reason: string | null
      excerpt: string | null
    }

export function adminAlertPayload(alert: AdminAlert, siteUrl: string): WebhookPayload {
  const by = (name: string | null) => (name ? `Reported by ${escapeMarkdown(name)}` : null)
  switch (alert.kind) {
    case 'bug_report':
      return payload({
        title: 'New bug report',
        url: `${siteUrl}/admin?tab=moderation`,
        color: COLORS.admin,
        description: truncate(alert.description, 1500),
        fields: alert.pagePath
          ? [{ name: 'Page', value: `${siteUrl}${alert.pagePath}` }]
          : undefined,
        footer: { text: by(alert.reporter) ?? SITE_NAME },
      })
    case 'match_report':
      return payload({
        title: `Captain result needs review: ${alert.matchLabel ?? 'match'}`,
        url: `${siteUrl}/admin/matches-import`,
        color: COLORS.admin,
        description:
          alert.reasons.length > 0
            ? truncate(alert.reasons.map((r) => `• ${r}`).join('\n'), 1500)
            : 'Held for review.',
        fields: [{ name: 'Match', value: `${siteUrl}/matches/${alert.matchId}` }],
        footer: { text: alert.submitter ? `Submitted by ${alert.submitter}` : SITE_NAME },
      })
    case 'comment_report':
      return payload({
        title: 'Comment reported',
        url: `${siteUrl}/admin?tab=moderation`,
        color: COLORS.admin,
        description:
          [
            alert.excerpt
              ? `> ${escapeMarkdown(truncate(alert.excerpt, 400)).replace(/\n/g, '\n> ')}`
              : null,
            alert.reason ? `Reason: ${escapeMarkdown(alert.reason)}` : null,
          ]
            .filter(Boolean)
            .join('\n') || 'No reason given.',
        footer: { text: by(alert.reporter) ?? SITE_NAME },
      })
  }
}
