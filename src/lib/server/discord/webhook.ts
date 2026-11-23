/*
 * A thin client for Discord webhook URLs (one URL per channel).
 *
 * Every call is best-effort: it has a short timeout, retries a rate limit
 * once, and reports failure through its return value and the log. Nothing
 * here throws, so a Discord outage can never break the site action that
 * triggered a post.
 *
 * Docs: https://discord.com/developers/docs/resources/webhook
 */

export type DiscordEmbed = {
  title?: string
  description?: string
  url?: string
  color?: number
  timestamp?: string
  footer?: { text: string }
  image?: { url: string }
  thumbnail?: { url: string }
  author?: { name: string; url?: string }
  fields?: Array<{ name: string; value: string; inline?: boolean }>
}

export type WebhookPayload = {
  content?: string
  embeds?: DiscordEmbed[]
  /** Who may be pinged. Defaults to nobody, so a team name can't ping @everyone. */
  allowed_mentions?: { parse?: Array<'roles' | 'users' | 'everyone'>; roles?: string[] }
  username?: string
  avatar_url?: string
}

export type WebhookOptions = {
  /** Log the request instead of sending it. */
  dryRun?: boolean
  timeoutMs?: number
  /** Longest `retry_after` worth waiting for; longer ones give up instead. */
  maxRetryWaitMs?: number
  fetch?: typeof fetch
  /** Post into (or edit inside) this thread, for a webhook on a forum channel. */
  threadId?: string | null
}

/** What an edit found: done, the message is gone from Discord, or it failed. */
export type EditResult = 'ok' | 'missing' | 'failed'

const DEFAULT_TIMEOUT_MS = 3000
const DEFAULT_MAX_RETRY_WAIT_MS = 5000
const WEBHOOK_URL_RE =
  /^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+$/

/** True for a webhook URL Discord would accept (used to ignore typos in env vars). */
export function isWebhookUrl(url: string | null | undefined): url is string {
  return Boolean(url && WEBHOOK_URL_RE.test(url))
}

/** The webhook URL without its secret token, for logs. */
function redact(url: string): string {
  return url.replace(/(webhooks\/\d+\/)[\w-]+/, '$1***')
}

let dryRunCounter = 0

type SendResult = { ok: true; status: number; body: unknown } | { ok: false; status: number }

async function send(
  method: 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload: WebhookPayload | null,
  options: WebhookOptions
): Promise<SendResult> {
  const doFetch = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxWait = options.maxRetryWaitMs ?? DEFAULT_MAX_RETRY_WAIT_MS
  const body = payload ? JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }) : undefined

  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response
    try {
      response = await doFetch(url, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      console.error(`Discord webhook ${method} ${redact(url)} failed:`, err)
      return { ok: false, status: 0 }
    }

    if (response.status === 429 && attempt === 0) {
      const retryMs = await retryAfterMs(response)
      if (retryMs != null && retryMs <= maxWait) {
        await new Promise((resolve) => setTimeout(resolve, retryMs))
        continue
      }
    }

    if (!response.ok) {
      // 404 is expected when someone deleted the message in Discord; the caller handles it.
      if (response.status !== 404) {
        const text = await response.text().catch(() => '')
        console.error(
          `Discord webhook ${method} ${redact(url)} returned ${response.status}: ${text.slice(0, 300)}`
        )
      }
      return { ok: false, status: response.status }
    }

    const parsed = response.status === 204 ? null : await response.json().catch(() => null)
    return { ok: true, status: response.status, body: parsed }
  }
  return { ok: false, status: 429 }
}

/** Discord gives `retry_after` in seconds, in the JSON body and the Retry-After header. */
async function retryAfterMs(response: Response): Promise<number | null> {
  const body = (await response.json().catch(() => null)) as { retry_after?: unknown } | null
  const seconds = Number(body?.retry_after ?? response.headers.get('retry-after'))
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : null
}

function withQuery(url: string, params: Record<string, string | null | undefined>): string {
  const query = Object.entries(params)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')
  return query ? `${url}?${query}` : url
}

function messageUrl(url: string, messageId: string, threadId?: string | null): string {
  return withQuery(`${url}/messages/${encodeURIComponent(messageId)}`, { thread_id: threadId })
}

/** Post a message. Returns its id, or null when it was not posted. */
export async function executeWebhook(
  url: string,
  payload: WebhookPayload,
  options: WebhookOptions = {}
): Promise<string | null> {
  if (options.dryRun) {
    const id = `dry-run-${Date.now()}-${++dryRunCounter}`
    console.info(
      `[discord dry-run] POST ${redact(url)}${options.threadId ? ` thread ${options.threadId}` : ''} -> ${id}\n${JSON.stringify(payload, null, 2)}`
    )
    return id
  }
  const result = await send(
    'POST',
    withQuery(url, { wait: 'true', thread_id: options.threadId }),
    payload,
    options
  )
  if (!result.ok) return null
  const id = (result.body as { id?: unknown } | null)?.id
  return typeof id === 'string' ? id : null
}

/** Replace a message this webhook posted. */
export async function editWebhookMessage(
  url: string,
  messageId: string,
  payload: WebhookPayload,
  options: WebhookOptions = {}
): Promise<EditResult> {
  if (options.dryRun) {
    console.info(
      `[discord dry-run] PATCH ${redact(url)} message ${messageId}\n${JSON.stringify(payload, null, 2)}`
    )
    return 'ok'
  }
  const result = await send('PATCH', messageUrl(url, messageId, options.threadId), payload, options)
  if (result.ok) return 'ok'
  return result.status === 404 ? 'missing' : 'failed'
}

/** Delete a message this webhook posted. A message that is already gone counts as deleted. */
export async function deleteWebhookMessage(
  url: string,
  messageId: string,
  options: WebhookOptions = {}
): Promise<boolean> {
  if (options.dryRun) {
    console.info(`[discord dry-run] DELETE ${redact(url)} message ${messageId}`)
    return true
  }
  const result = await send('DELETE', messageUrl(url, messageId, options.threadId), null, options)
  return result.ok || result.status === 404
}
