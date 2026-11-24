import { LEAGUE_TIME_ZONE, SITE_NAME } from '$lib/meta'
import type { DiscordEmbed, WebhookPayload } from './webhook'

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

export function matchReminderPayload(match: MatchRef): WebhookPayload {
  const start = discordTimestamp(match.scheduledAt, 'R')
  return payload({
    title: `Starting soon: ${versusTitle(match)}`,
    url: matchUrl(match),
    color: COLORS.schedule,
    description: [
      versus(match),
      start ? `Starts ${start} (${discordTimestamp(match.scheduledAt, 't')})` : null,
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

export type MatchResultInput = MatchRef & {
  scoreA: number
  scoreB: number
  winner: 'a' | 'b' | null
  maps: Array<{ name: string; a: number; b: number }>
  mvp: { name: string; acs: number | null; agent?: string | null } | null
  /** Changes when the result does, so Discord refetches the card after a correction. */
  cardVersion?: string
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

  const fields: NonNullable<DiscordEmbed['fields']> = match.maps.slice(0, 7).map((map, i) => ({
    name: `Map ${i + 1} · ${map.name}`,
    value: `${map.a} – ${map.b}`,
    inline: true,
  }))
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
  return payload({
    title: winnerName
      ? `${winnerName} win ${Math.max(match.scoreA, match.scoreB)}–${Math.min(match.scoreA, match.scoreB)}`
      : `Final: ${versusTitle(match)}`,
    url: matchUrl(match),
    color: COLORS.result,
    description: scoreLine,
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
  const lock = discordTimestamp(p.lockAt, 'R')
  return payload({
    title: `${p.title} locks soon`,
    url: pickemUrl(p),
    color: COLORS.pickem,
    description: [`Picks lock ${lock ?? 'soon'}. Last chance!`, pickemUrl(p)].join('\n'),
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

export function pickemWinnerPayload(
  p: PickemRef & { podium: Array<{ name: string; score: number; rank: number }> }
): WebhookPayload {
  const winners = p.podium.filter((e) => e.rank === 1)
  const medals = ['🥇', '🥈', '🥉']
  const lines = p.podium
    .slice(0, 10)
    .map((e) => `${medals[e.rank - 1] ?? `#${e.rank}`} ${escapeMarkdown(e.name)} · ${e.score} pts`)
  const names = winners.map((w) => w.name).join(' & ')
  return payload({
    title:
      winners.length > 0
        ? `${names} ${winners.length > 1 ? 'win' : 'wins'} the ${p.title}!`
        : `${p.title} results`,
    url: pickemUrl(p),
    color: COLORS.pickem,
    description: [...lines, '', `Full leaderboard: ${pickemUrl(p)}`].join('\n'),
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
