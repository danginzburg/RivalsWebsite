import { describe, expect, it } from 'vitest'
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

  it('says so for an unknown command', async () => {
    const res = await handleInteraction({ type: 2, data: { name: 'nope' } }, ORIGIN)
    expect(res.data?.flags).toBe(64)
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
