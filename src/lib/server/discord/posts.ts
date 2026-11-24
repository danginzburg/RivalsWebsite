import { supabaseAdmin } from '$lib/supabase/admin'
import {
  deleteWebhookMessage,
  editWebhookMessage,
  executeWebhook,
  type WebhookOptions,
  type WebhookPayload,
} from './webhook'

/*
 * Posts the site has made, keyed by (kind, subject, channel), so a correction
 * edits the message it already posted instead of posting a second one.
 */

export type PostKey = { kind: string; subjectId: string; channel: string }
export type PostRow = { messageId: string | null; threadId: string | null; updatedAt: string }

/** Storage for posts: the `discord_posts` table, swappable in tests. */
export type PostStore = {
  get(key: PostKey): Promise<PostRow | null>
  /** Reserve the key before posting. False when another request already holds it. */
  claim(key: PostKey, threadId: string | null): Promise<boolean>
  save(key: PostKey, messageId: string, threadId: string | null): Promise<void>
  remove(key: PostKey): Promise<void>
}

const supabaseStore: PostStore = {
  async get(key) {
    const { data, error } = await supabaseAdmin
      .from('discord_posts')
      .select('message_id, thread_id, updated_at')
      .eq('kind', key.kind)
      .eq('subject_id', key.subjectId)
      .eq('channel', key.channel)
      .maybeSingle()
    if (error) throw new Error(`discord_posts lookup failed: ${error.message}`)
    return data
      ? {
          messageId: (data.message_id as string | null) ?? null,
          threadId: (data.thread_id as string | null) ?? null,
          updatedAt: data.updated_at as string,
        }
      : null
  },
  async claim(key, threadId) {
    const { error } = await supabaseAdmin.from('discord_posts').insert({
      kind: key.kind,
      subject_id: key.subjectId,
      channel: key.channel,
      thread_id: threadId,
    })
    if (!error) return true
    if (error.code === '23505') return false
    throw new Error(`discord_posts claim failed: ${error.message}`)
  },
  async save(key, messageId, threadId) {
    const { error } = await supabaseAdmin
      .from('discord_posts')
      .update({ message_id: messageId, thread_id: threadId, updated_at: new Date().toISOString() })
      .eq('kind', key.kind)
      .eq('subject_id', key.subjectId)
      .eq('channel', key.channel)
    if (error) throw new Error(`discord_posts save failed: ${error.message}`)
  },
  async remove(key) {
    const { error } = await supabaseAdmin
      .from('discord_posts')
      .delete()
      .eq('kind', key.kind)
      .eq('subject_id', key.subjectId)
      .eq('channel', key.channel)
    if (error) throw new Error(`discord_posts delete failed: ${error.message}`)
  },
}

let store: PostStore = supabaseStore

/** Tests only: swap the table for an in-memory store. Pass nothing to restore it. */
export function setPostStore(next?: PostStore) {
  store = next ?? supabaseStore
}

/** A claim younger than this is another request still posting; older ones failed midway. */
const CLAIM_STALE_MS = 60_000

export type UpsertMode =
  /** Edit the existing message, or post one. */
  | 'upsert'
  /** Only edit an existing message (corrections to things posted earlier). */
  | 'edit'
  /** Post once; never edit or repost (reminders, alerts). */
  | 'once'

export type UpsertResult = 'posted' | 'edited' | 'skipped' | 'failed'

/**
 * Post `payload` under `key`, or edit the message already posted under it.
 * Never throws.
 */
export async function upsertPost(
  key: PostKey,
  url: string,
  payload: WebhookPayload,
  options: WebhookOptions & { mode?: UpsertMode } = {}
): Promise<UpsertResult> {
  const mode = options.mode ?? 'upsert'
  try {
    const existing = await store.get(key)

    if (existing?.messageId) {
      if (mode === 'once') return 'skipped'
      const threadId = existing.threadId ?? options.threadId ?? null
      const edited = await editWebhookMessage(url, existing.messageId, payload, {
        ...options,
        threadId,
      })
      if (edited === 'ok') {
        await store.save(key, existing.messageId, threadId)
        return 'edited'
      }
      if (edited === 'failed') return 'failed'
      // Someone deleted the message in Discord. Forget it, and post afresh unless only editing.
      await store.remove(key)
      if (mode === 'edit') return 'skipped'
    } else if (existing) {
      // A claim with no message yet: someone else is posting, or an earlier post failed.
      const age = Date.now() - new Date(existing.updatedAt).getTime()
      if (mode === 'edit' || age < CLAIM_STALE_MS) return 'skipped'
      await store.remove(key)
    } else if (mode === 'edit') {
      return 'skipped'
    }

    const threadId = options.threadId ?? null
    if (!(await store.claim(key, threadId))) return 'skipped'
    const messageId = await executeWebhook(url, payload, { ...options, threadId })
    if (!messageId) {
      // Release the claim so a later event can try again.
      await store.remove(key)
      return 'failed'
    }
    await store.save(key, messageId, threadId)
    return 'posted'
  } catch (err) {
    console.error(`Discord post ${key.kind}:${key.subjectId} (${key.channel}) failed:`, err)
    return 'failed'
  }
}

/** Delete the message posted under `key`, if any. Never throws. */
export async function deletePost(
  key: PostKey,
  url: string,
  options: WebhookOptions = {}
): Promise<boolean> {
  try {
    const existing = await store.get(key)
    if (!existing) return false
    if (existing.messageId) {
      const ok = await deleteWebhookMessage(url, existing.messageId, {
        ...options,
        threadId: existing.threadId ?? options.threadId ?? null,
      })
      if (!ok) return false
    }
    await store.remove(key)
    return true
  } catch (err) {
    console.error(`Discord delete ${key.kind}:${key.subjectId} (${key.channel}) failed:`, err)
    return false
  }
}

/** The forum thread the Discord bot linked to a match, if any. */
export async function matchThreadId(matchId: string): Promise<string | null> {
  try {
    const row = await store.get({ kind: 'match_thread', subjectId: matchId, channel: 'scheduling' })
    return row?.threadId ?? row?.messageId ?? null
  } catch (err) {
    console.error('Failed to look up the match thread:', err)
    return null
  }
}
