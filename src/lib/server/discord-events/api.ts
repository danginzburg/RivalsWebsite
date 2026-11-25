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

// ---------------------------------------------------------------------------
// Forum threads (match scheduling)

export type DiscordThread = {
  id: string
  name: string
  parent_id: string | null
  type: number
  /** Changes whenever someone posts, so unchanged threads can be skipped. */
  last_message_id?: string | null
}

/** The server's active (not archived) threads. */
export async function listActiveThreads(config: DiscordConfig): Promise<DiscordThread[]> {
  const res = await call<{ threads: DiscordThread[] }>(
    config,
    'GET',
    `/guilds/${config.guildId}/threads/active`
  )
  return res?.threads ?? []
}

/**
 * Open a post in a forum channel. The starter message's id is the thread's id.
 * The bot needs Create Posts in the forum, and Mention @everyone (or the
 * roles set to "Allow anyone to @mention") for role pings to notify.
 */
export async function createForumThread(
  config: DiscordConfig,
  forumId: string,
  name: string,
  message: unknown
): Promise<DiscordThread> {
  const thread = await call<DiscordThread>(config, 'POST', `/channels/${forumId}/threads`, {
    name,
    // A week, the longest Discord allows; the sync only reads active threads.
    auto_archive_duration: 10080,
    message,
  })
  if (!thread) throw new DiscordApiError(500, 'Discord returned no thread')
  return thread
}

/** Rename, archive or lock a thread (Manage Threads); null if it was deleted. */
export async function updateThread(
  config: DiscordConfig,
  threadId: string,
  changes: { name?: string; archived?: boolean; locked?: boolean }
): Promise<DiscordThread | null> {
  try {
    return await call<DiscordThread>(config, 'PATCH', `/channels/${threadId}`, changes)
  } catch (err) {
    if (err instanceof DiscordApiError && err.status === 404) return null
    throw err
  }
}

export type DiscordMessage = {
  id: string
  author?: { id: string } | null
  content?: string | null
  embeds?: Array<{ description?: string | null; fields?: Array<{ value?: string | null }> }>
}

/**
 * A thread's messages, oldest first, up to `max`. Message text is only
 * included with the bot's Message Content intent turned on.
 */
export async function listMessages(
  config: DiscordConfig,
  channelId: string,
  max = 300
): Promise<DiscordMessage[]> {
  const all: DiscordMessage[] = []
  let before: string | null = null
  while (all.length < max) {
    const query = new URLSearchParams({ limit: '100' })
    if (before) query.set('before', before)
    const page: DiscordMessage[] =
      (await call<DiscordMessage[]>(config, 'GET', `/channels/${channelId}/messages?${query}`)) ??
      []
    all.push(...page)
    if (page.length < 100) break
    before = page[page.length - 1]!.id
  }
  // Discord returns newest first.
  return all.reverse()
}

/** Post a message in a channel or thread; the bot needs Send Messages in Threads. */
export async function sendMessage(
  config: DiscordConfig,
  channelId: string,
  body: unknown
): Promise<DiscordMessage> {
  const sent = await call<DiscordMessage>(config, 'POST', `/channels/${channelId}/messages`, body)
  if (!sent) throw new DiscordApiError(500, 'Discord returned no message')
  return sent
}

/**
 * DM a user. Fails (403, code 50007) when they share no server with the bot
 * or have DMs from server members turned off.
 */
export async function sendDirectMessage(
  config: DiscordConfig,
  userId: string,
  body: unknown
): Promise<DiscordMessage> {
  const channel = await call<{ id: string }>(config, 'POST', '/users/@me/channels', {
    recipient_id: userId,
  })
  if (!channel) throw new DiscordApiError(500, 'Discord returned no DM channel')
  return sendMessage(config, channel.id, body)
}

/** Edit one of the bot's messages; null if it was deleted. */
export async function editMessage(
  config: DiscordConfig,
  channelId: string,
  messageId: string,
  body: unknown
): Promise<DiscordMessage | null> {
  try {
    return await call<DiscordMessage>(
      config,
      'PATCH',
      `/channels/${channelId}/messages/${messageId}`,
      body
    )
  } catch (err) {
    if (err instanceof DiscordApiError && err.status === 404) return null
    throw err
  }
}

/**
 * Replace the reply to a deferred interaction (the "thinking…" message).
 * Authenticated by the interaction's own token, valid for 15 minutes.
 */
export async function editOriginalResponse(
  applicationId: string,
  interactionToken: string,
  body: unknown
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/webhooks/${applicationId}/${interactionToken}/messages/@original`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new DiscordApiError(res.status, `Discord follow-up failed (${res.status}): ${text}`)
  }
}
