import { describe, expect, it } from 'vitest'
import { RateLimitWaitError, RateLimiter } from './rate-limiter'

/** A limiter on a fake clock: sleeping just advances time. */
function fakeLimiter(limitPerMinute = 30) {
  const clock = { now: 0 }
  const sent: number[] = []
  const limiter = new RateLimiter({
    limitPerMinute,
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms
    },
  })
  const send = async (maxWaitMs?: number) => {
    await limiter.acquire(maxWaitMs)
    sent.push(clock.now)
  }
  return { clock, limiter, sent, send }
}

function headers(values: Record<string, string>) {
  return new Headers(values)
}

describe('RateLimiter', () => {
  it('keeps 250 requests under 30 in any minute', async () => {
    const { sent, send } = fakeLimiter(30)
    for (let i = 0; i < 250; i++) await send()

    for (const start of sent) {
      const inWindow = sent.filter((t) => t >= start && t < start + 60_000).length
      expect(inWindow).toBeLessThanOrEqual(30)
    }
  })

  it('queues concurrent callers instead of letting them burst', async () => {
    // Clock frozen at 0: each caller's sleep is exactly when its slot comes up.
    const waits: number[] = []
    const limiter = new RateLimiter({
      limitPerMinute: 30,
      now: () => 0,
      sleep: async (ms) => {
        waits.push(ms)
      },
    })
    await Promise.all(Array.from({ length: 5 }, () => limiter.acquire()))
    expect(waits).toEqual([2200, 4400, 6600, 8800])
  })

  it('refuses a wait longer than the caller allows', async () => {
    const { send } = fakeLimiter(30)
    await send()
    await expect(send(500)).rejects.toBeInstanceOf(RateLimitWaitError)
    // The refused caller did not take the slot.
    await expect(send(2500)).resolves.toBeUndefined()
  })

  it('adopts the limit the API reports', async () => {
    const { limiter } = fakeLimiter(30)
    limiter.observe(headers({ 'x-ratelimit-limit': '90' }), 200)
    expect(limiter.intervalMs).toBeLessThan(1000)
  })

  it('waits out the window when the API says none are left', async () => {
    const { limiter, clock, send } = fakeLimiter(30)
    limiter.observe(headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '40' }), 200)
    await send()
    expect(clock.now).toBe(40_000)
  })

  it('backs off after a 429', async () => {
    const { limiter, clock, send } = fakeLimiter(30)
    limiter.observe(headers({ 'retry-after': '15' }), 429)
    expect(limiter.blockedForMs).toBe(15_000)
    await send()
    expect(clock.now).toBe(15_000)
  })

  it('backs off a full minute after a 429 with no hint', async () => {
    const { limiter } = fakeLimiter(30)
    limiter.observe(headers({}), 429)
    expect(limiter.blockedForMs).toBe(60_000)
  })
})
