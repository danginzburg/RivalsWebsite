import { env } from '$env/dynamic/private'
import type { DiscordEvent, EventBody } from './plan'

/**
 * The few Discord REST calls the event sync makes, authenticated as the bot.
 * https://discord.com/developers/docs/resources/guild-scheduled-event
 */

const API_BASE = 'https://discord.com/api/v10'

/** Longest a single call may take; a site edit waits on it. */
const TIMEOUT_MS = 8_000

export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export type DiscordConfig = { token: string; guildId: string }

/** The bot's credentials, or null when the sync is not set up (local dev, previews). */
export function discordConfig(): DiscordConfig | null {
  const token = env.DISCORD_BOT_TOKEN?.trim()
  const guildId = env.DISCORD_GUILD_ID?.trim()
  return token && guildId ? { token, guildId } : null
}

async function call<T>(
  config: DiscordConfig,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  retried = false
): Promise<T | null> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${config.token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'DiscordBot (https://github.com, 1.0)',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  // One short retry on a rate limit; anything longer waits for the next run.
  if (res.status === 429 && !retried) {
    const data = (await res.json().catch(() => ({}))) as { retry_after?: number }
    const wait = Math.ceil((data.retry_after ?? 1) * 1000)
    if (wait <= 5_000) {
      await new Promise((resolve) => setTimeout(resolve, wait))
      return call(config, method, path, body, true)
    }
  }

  if (res.status === 404 && method === 'GET') return null
  if (res.status === 204) return null
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new DiscordApiError(
      res.status,
      `Discord ${method} ${path} failed (${res.status}): ${text}`
    )
  }
  return (await res.json()) as T
}

const eventsPath = (config: DiscordConfig) => `/guilds/${config.guildId}/scheduled-events`

/** The server's scheduled and live events (Discord drops ended and cancelled ones). */
export async function listEvents(config: DiscordConfig): Promise<DiscordEvent[]> {
  return (await call<DiscordEvent[]>(config, 'GET', eventsPath(config))) ?? []
}

/** One event, or null if it was deleted. */
export function getEvent(config: DiscordConfig, id: string): Promise<DiscordEvent | null> {
  return call<DiscordEvent>(config, 'GET', `${eventsPath(config)}/${id}`)
}

export async function createEvent(config: DiscordConfig, body: EventBody): Promise<DiscordEvent> {
  const created = await call<DiscordEvent>(config, 'POST', eventsPath(config), body)
  if (!created) throw new DiscordApiError(500, 'Discord returned no event')
  return created
}

export function updateEvent(
  config: DiscordConfig,
  id: string,
  body: EventBody
): Promise<DiscordEvent | null> {
  return call<DiscordEvent>(config, 'PATCH', `${eventsPath(config)}/${id}`, body)
}

export async function deleteEvent(config: DiscordConfig, id: string): Promise<void> {
  try {
    await call(config, 'DELETE', `${eventsPath(config)}/${id}`)
  } catch (err) {
    // Already gone is the outcome we wanted.
    if (err instanceof DiscordApiError && err.status === 404) return
    throw err
  }
}

let botUserId: string | null = null

/** The bot's own user id, so its events are not mistaken for ones made by hand. */
export async function getBotUserId(config: DiscordConfig): Promise<string | null> {
  if (botUserId) return botUserId
  const me = await call<{ id: string }>(config, 'GET', '/users/@me')
  botUserId = me?.id ?? null
  return botUserId
}
