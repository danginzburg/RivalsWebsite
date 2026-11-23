import { env } from '$env/dynamic/private'
import { isWebhookUrl, type WebhookOptions } from './webhook'

/*
 * Which Discord channel each kind of post goes to. Every channel is one
 * webhook URL in an env var; a channel without one is skipped quietly.
 */
export const DISCORD_CHANNELS = {
  /** #match-results */
  results: 'DISCORD_WEBHOOK_RESULTS',
  /** r5-match-scheduling forum: posts go into each match's thread. */
  scheduling: 'DISCORD_WEBHOOK_SCHEDULING',
  /** #vods */
  vods: 'DISCORD_WEBHOOK_VODS',
  /** #team-logos */
  team_logos: 'DISCORD_WEBHOOK_TEAM_LOGOS',
  /** #official-streams (pings the stream role when a match goes live) */
  streams: 'DISCORD_WEBHOOK_STREAMS',
  /** #prod-announcements (a stream link was added to a match) */
  prod: 'DISCORD_WEBHOOK_PROD',
  /** #rivals-annoucements (pick'ems) */
  announcements: 'DISCORD_WEBHOOK_ANNOUNCEMENTS',
  /** Private staff channel (moderation queue alerts) */
  admin: 'DISCORD_WEBHOOK_ADMIN',
} as const

export type DiscordChannel = keyof typeof DISCORD_CHANNELS

/** Stands in for a missing URL in dry-run mode, so every post can be exercised locally. */
const DRY_RUN_URL = 'https://discord.com/api/webhooks/0/dry-run'

export function isDryRun(): boolean {
  return env.DISCORD_DRY_RUN === '1' || env.DISCORD_DRY_RUN === 'true'
}

export function webhookUrlFor(channel: DiscordChannel): string | null {
  const url = env[DISCORD_CHANNELS[channel]]?.trim()
  if (isWebhookUrl(url)) return url
  if (url) console.warn(`${DISCORD_CHANNELS[channel]} is not a Discord webhook URL; skipping.`)
  return isDryRun() ? DRY_RUN_URL : null
}

export function webhookOptions(): WebhookOptions {
  return { dryRun: isDryRun() }
}

/** Role pinged when a match goes live (@Stream Ping). */
export function streamPingRoleId(): string | null {
  const id = env.DISCORD_STREAM_PING_ROLE_ID?.trim()
  return id && /^\d+$/.test(id) ? id : null
}

/**
 * The public site origin for links and images in posts. Posts are built
 * after the response, with no request to read it from.
 */
export function siteUrl(): string {
  const configured = env.SITE_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  if (vercel) return `https://${vercel}`
  return 'http://localhost:5173'
}
