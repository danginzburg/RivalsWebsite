import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('$lib/supabase/admin', () => ({ supabaseAdmin: {} }))

import {
  deletePost,
  sendOnce,
  setPostStore,
  upsertPost,
  type PostKey,
  type PostRow,
  type PostStore,
} from './posts'
import { editWebhookMessage, executeWebhook } from './webhook'

const URL = 'https://discord.com/api/webhooks/123/secret-token'
const KEY: PostKey = { kind: 'match_result', subjectId: 'm-1', channel: 'results' }

function memoryStore() {
  const rows = new Map<string, PostRow>()
  const id = (k: PostKey) => `${k.kind}|${k.subjectId}|${k.channel}`
  const store: PostStore = {
    async get(k) {
      return rows.get(id(k)) ?? null
    },
    async claim(k, threadId) {
      if (rows.has(id(k))) return false
      rows.set(id(k), { messageId: null, threadId, updatedAt: new Date().toISOString() })
      return true
    },
    async save(k, messageId, threadId) {
      rows.set(id(k), { messageId, threadId, updatedAt: new Date().toISOString() })
    },
    async remove(k) {
      rows.delete(id(k))
    },
  }
  return { store, rows }
}

type Call = { method: string; url: string; body: unknown }

/** A fake Discord: records calls and answers from a queue of responses. */
function fakeDiscord(responses: Array<() => Response> = []) {
  const calls: Call[] = []
  let nextId = 1000
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? 'GET',
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    })
    const queued = responses.shift()
    if (queued) return queued()
    if (init?.method === 'POST') return Response.json({ id: String(nextId++) })
    if (init?.method === 'DELETE') return new Response(null, { status: 204 })
    return Response.json({ id: 'edited' })
  }) as unknown as typeof globalThis.fetch
  return { fetch, calls }
}

let mem: ReturnType<typeof memoryStore>

beforeEach(() => {
  mem = memoryStore()
  setPostStore(mem.store)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  setPostStore()
  vi.restoreAllMocks()
})

describe('webhook client', () => {
  it('posts with wait=true, blocks mentions by default and returns the message id', async () => {
    const d = fakeDiscord()
    const id = await executeWebhook(URL, { content: 'hi' }, { fetch: d.fetch })
    expect(id).toBe('1000')
    expect(d.calls[0].url).toBe(`${URL}?wait=true`)
    expect(d.calls[0].body).toEqual({ allowed_mentions: { parse: [] }, content: 'hi' })
  })

  it('posts and edits inside a forum thread', async () => {
    const d = fakeDiscord()
    await executeWebhook(URL, { content: 'hi' }, { fetch: d.fetch, threadId: '777' })
    await editWebhookMessage(URL, '55', { content: 'yo' }, { fetch: d.fetch, threadId: '777' })
    expect(d.calls[0].url).toBe(`${URL}?wait=true&thread_id=777`)
    expect(d.calls[1]).toMatchObject({ method: 'PATCH', url: `${URL}/messages/55?thread_id=777` })
  })

  it('waits out one 429 and retries', async () => {
    const d = fakeDiscord([() => Response.json({ retry_after: 0.01 }, { status: 429 })])
    expect(await executeWebhook(URL, { content: 'hi' }, { fetch: d.fetch })).toBe('1000')
    expect(d.calls).toHaveLength(2)
  })

  it('gives up on a second 429 or a long retry_after, without throwing', async () => {
    const twice = fakeDiscord([
      () => Response.json({ retry_after: 0.01 }, { status: 429 }),
      () => Response.json({ retry_after: 0.01 }, { status: 429 }),
    ])
    expect(await executeWebhook(URL, { content: 'hi' }, { fetch: twice.fetch })).toBeNull()
    expect(twice.calls).toHaveLength(2)

    const long = fakeDiscord([() => Response.json({ retry_after: 60 }, { status: 429 })])
    expect(await executeWebhook(URL, { content: 'hi' }, { fetch: long.fetch })).toBeNull()
    expect(long.calls).toHaveLength(1)
  })

  it('returns null when the network fails or times out', async () => {
    const failing = vi.fn(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    }) as unknown as typeof fetch
    expect(await executeWebhook(URL, { content: 'hi' }, { fetch: failing })).toBeNull()
  })

  it('reports an edit of a deleted message as missing', async () => {
    const d = fakeDiscord([() => Response.json({ code: 10008 }, { status: 404 })])
    expect(await editWebhookMessage(URL, '55', { content: 'x' }, { fetch: d.fetch })).toBe(
      'missing'
    )
  })

  it('logs instead of sending in dry-run mode', async () => {
    const d = fakeDiscord()
    const id = await executeWebhook(URL, { content: 'hi' }, { fetch: d.fetch, dryRun: true })
    expect(id).toMatch(/^dry-run-/)
    expect(d.calls).toHaveLength(0)
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('webhooks/123/***'))
  })
})

describe('upsertPost', () => {
  it('posts once, then edits the same message on a correction', async () => {
    const d = fakeDiscord()
    expect(await upsertPost(KEY, URL, { content: '2-1' }, { fetch: d.fetch })).toBe('posted')
    expect(await upsertPost(KEY, URL, { content: '2-0' }, { fetch: d.fetch })).toBe('edited')
    expect(d.calls.map((c) => c.method)).toEqual(['POST', 'PATCH'])
    expect(d.calls[1].url).toBe(`${URL}/messages/1000`)
    expect((await mem.store.get(KEY))?.messageId).toBe('1000')
  })

  it('reposts when the message was deleted in Discord', async () => {
    const d = fakeDiscord()
    await upsertPost(KEY, URL, { content: 'a' }, { fetch: d.fetch })
    const gone = fakeDiscord([() => new Response(null, { status: 404 })])
    expect(await upsertPost(KEY, URL, { content: 'b' }, { fetch: gone.fetch })).toBe('posted')
    expect(gone.calls.map((c) => c.method)).toEqual(['PATCH', 'POST'])
  })

  it('keeps the old message when an edit fails, rather than posting a duplicate', async () => {
    const d = fakeDiscord()
    await upsertPost(KEY, URL, { content: 'a' }, { fetch: d.fetch })
    const broken = fakeDiscord([() => new Response('boom', { status: 500 })])
    expect(await upsertPost(KEY, URL, { content: 'b' }, { fetch: broken.fetch })).toBe('failed')
    expect(broken.calls).toHaveLength(1)
    expect((await mem.store.get(KEY))?.messageId).toBe('1000')
  })

  it('releases the claim when posting fails, so a later event can retry', async () => {
    const broken = fakeDiscord([() => new Response('boom', { status: 500 })])
    expect(await upsertPost(KEY, URL, { content: 'a' }, { fetch: broken.fetch })).toBe('failed')
    expect(await mem.store.get(KEY)).toBeNull()
  })

  it("edit mode never posts something that wasn't posted before", async () => {
    const d = fakeDiscord()
    expect(await upsertPost(KEY, URL, { content: 'a' }, { fetch: d.fetch, mode: 'edit' })).toBe(
      'skipped'
    )
    expect(d.calls).toHaveLength(0)
  })

  it('once mode posts a single time', async () => {
    const d = fakeDiscord()
    expect(await upsertPost(KEY, URL, { content: 'a' }, { fetch: d.fetch, mode: 'once' })).toBe(
      'posted'
    )
    expect(await upsertPost(KEY, URL, { content: 'a' }, { fetch: d.fetch, mode: 'once' })).toBe(
      'skipped'
    )
    expect(d.calls).toHaveLength(1)
  })

  it('skips while another request holds a fresh claim', async () => {
    await mem.store.claim(KEY, null)
    const d = fakeDiscord()
    expect(await upsertPost(KEY, URL, { content: 'a' }, { fetch: d.fetch })).toBe('skipped')
    expect(d.calls).toHaveLength(0)
  })

  it('keeps editing inside the thread it first posted to', async () => {
    const d = fakeDiscord()
    await upsertPost(KEY, URL, { content: 'a' }, { fetch: d.fetch, threadId: '777' })
    await upsertPost(KEY, URL, { content: 'b' }, { fetch: d.fetch })
    expect(d.calls[1].url).toBe(`${URL}/messages/1000?thread_id=777`)
  })

  it('works end to end in dry-run mode, including the edit', async () => {
    const d = fakeDiscord()
    expect(await upsertPost(KEY, URL, { content: 'a' }, { fetch: d.fetch, dryRun: true })).toBe(
      'posted'
    )
    expect(await upsertPost(KEY, URL, { content: 'b' }, { fetch: d.fetch, dryRun: true })).toBe(
      'edited'
    )
    expect(d.calls).toHaveLength(0)
  })

  it('never throws when storage fails', async () => {
    setPostStore({
      ...mem.store,
      get: async () => {
        throw new Error('db down')
      },
    })
    expect(await upsertPost(KEY, URL, { content: 'a' }, { fetch: fakeDiscord().fetch })).toBe(
      'failed'
    )
  })
})

describe('deletePost', () => {
  it('deletes the message and forgets it', async () => {
    const d = fakeDiscord()
    await upsertPost(KEY, URL, { content: 'a' }, { fetch: d.fetch })
    expect(await deletePost(KEY, URL, { fetch: d.fetch })).toBe(true)
    expect(d.calls[1]).toMatchObject({ method: 'DELETE', url: `${URL}/messages/1000` })
    expect(await mem.store.get(KEY)).toBeNull()
  })
})

describe('sendOnce', () => {
  const DM: PostKey = { kind: 'match_reminder_dm', subjectId: 'm-1:t:111', channel: 'dm' }

  it('sends once, then skips', async () => {
    const { store } = memoryStore()
    setPostStore(store)
    const send = vi.fn(async () => 'msg-1')
    expect(await sendOnce(DM, send)).toBe('posted')
    expect(await sendOnce(DM, send)).toBe('skipped')
    expect(send).toHaveBeenCalledTimes(1)
    setPostStore()
  })

  it('releases the key when sending fails, so a later run retries', async () => {
    const { store, rows } = memoryStore()
    setPostStore(store)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(
      await sendOnce(DM, async () => {
        throw new Error('boom')
      })
    ).toBe('failed')
    expect(rows.size).toBe(0)
    expect(await sendOnce(DM, async () => 'msg-2')).toBe('posted')
    setPostStore()
  })
})
