import { describe, expect, it, vi } from 'vitest'

// Keep a developer's local .env (a real forum id, say) out of these tests.
vi.mock('$env/dynamic/private', () => ({ env: {} }))

import { handleInteraction, linkMatchChannelProblem } from './interactions'

const ORIGIN = 'https://rivals.example'

describe('handleInteraction', () => {
  it('answers a PING with a PONG', async () => {
    expect(await handleInteraction({ type: 1 }, ORIGIN)).toEqual({ type: 1 })
  })

  it('refuses /link-match outside a thread, privately', async () => {
    const res = await handleInteraction(
      {
        type: 2,
        data: { name: 'link-match', options: [{ name: 'match', type: 3, value: 'x' }] },
        channel: { id: 'c1', type: 0 },
      },
      ORIGIN
    )
    expect(res.type).toBe(4)
    expect(res.data?.flags).toBe(64)
    expect(String(res.data?.content)).toContain('scheduling thread')
  })

  it('asks for a match from the list when the value is not a match id', async () => {
    const res = await handleInteraction(
      {
        type: 2,
        data: { name: 'link-match', options: [{ name: 'match', type: 3, value: 'sen vs c9' }] },
        channel: { id: 't1', type: 11, parent_id: 'forum' },
      },
      ORIGIN
    )
    expect(res.data?.flags).toBe(64)
    expect(String(res.data?.content)).toContain('Pick a match')
  })

  it('refuses a button it does not know, privately', async () => {
    const res = await handleInteraction(
      { type: 3, data: { custom_id: 'something:else' }, channel_id: 't1' },
      ORIGIN
    )
    expect(res.type).toBe(4)
    expect(res.data?.flags).toBe(64)
  })

  it('closes a veto prompt that no longer has an offer behind it', async () => {
    const res = await handleInteraction(
      {
        type: 3,
        data: { custom_id: 'veto:update:abc123' },
        channel_id: 'no-such-thread',
        member: { user: { id: 'u1' }, permissions: '0' },
      },
      ORIGIN
    )
    expect(res.type).toBe(7)
    expect(res.data?.components).toEqual([])
    expect(String(res.data?.content)).toContain('no longer applies')
  })

  it('says so for an unknown command', async () => {
    const res = await handleInteraction({ type: 2, data: { name: 'nope' } }, ORIGIN)
    expect(res.data?.flags).toBe(64)
  })
})

describe('/set-time', () => {
  const setTime = (member: { user?: { id?: string }; permissions?: string }, channel?: object) =>
    handleInteraction(
      {
        type: 2,
        application_id: 'app',
        token: 'tok',
        data: {
          name: 'set-time',
          options: [
            { name: 'date', type: 3, value: 'fri' },
            { name: 'time', type: 3, value: '7pm' },
          ],
        },
        member,
        channel_id: 't1',
        channel: channel as never,
      },
      ORIGIN
    )

  it('refuses anyone who isn’t staff, privately', async () => {
    const res = await setTime({ user: { id: 'u1' }, permissions: '0' }, { id: 't1', type: 11 })
    expect(res.data?.flags).toBe(64)
    expect(String(res.data?.content)).toContain('Only staff')
  })

  it('needs a scheduling thread', async () => {
    const manageEvents = String(1n << 33n)
    const res = await setTime(
      { user: { id: 'u1' }, permissions: manageEvents },
      { id: 'c', type: 0 }
    )
    expect(res.data?.flags).toBe(64)
    expect(String(res.data?.content)).toContain('scheduling thread')
  })

  it('offers days and evening times as you type', async () => {
    const ask = (name: string, value: string) =>
      handleInteraction(
        { type: 4, data: { name: 'set-time', options: [{ name, type: 3, value, focused: true }] } },
        ORIGIN
      )
    const days = (await ask('date', '')).data?.choices as Array<{ name: string }>
    expect(days).toHaveLength(14)
    expect(days[0]!.name).toMatch(/^Today, /)

    const typed = (await ask('time', '8:15pm')).data?.choices as Array<{ value: string }>
    expect(typed[0]!.value).toBe('8:15pm')
    const evening = (await ask('time', '7:')).data?.choices as Array<{ value: string }>
    expect(evening.map((c) => c.value)).toEqual(['7:00 PM', '7:30 PM'])
  })
})

describe('linkMatchChannelProblem', () => {
  it('accepts a thread of the scheduling forum', () => {
    expect(linkMatchChannelProblem({ id: 't', type: 11, parent_id: 'forum' }, 'forum')).toBeNull()
    expect(linkMatchChannelProblem({ id: 't', type: 12, parent_id: 'x' }, null)).toBeNull()
  })

  it('rejects other channels and other forums', () => {
    expect(linkMatchChannelProblem({ id: 'c', type: 0 }, 'forum')).toContain('thread')
    expect(linkMatchChannelProblem(undefined, null)).toContain('thread')
    expect(linkMatchChannelProblem({ id: 't', type: 11, parent_id: 'other' }, 'forum')).toContain(
      'forum'
    )
  })
})
