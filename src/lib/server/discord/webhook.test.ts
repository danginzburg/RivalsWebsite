import { describe, expect, it, vi } from 'vitest'
import { deleteWebhookMessage, editWebhookMessage } from './webhook'

const URL = 'https://discord.com/api/webhooks/1/token'

describe('message ids left by a dry run', () => {
  it('are treated as deleted instead of sent to Discord', async () => {
    const fetch = vi.fn()
    expect(await editWebhookMessage(URL, 'dry-run-1-1', { content: 'x' }, { fetch })).toBe(
      'missing'
    )
    expect(await deleteWebhookMessage(URL, 'dry-run-1-1', { fetch })).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('real ids still go to Discord', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }))
    expect(await editWebhookMessage(URL, '1234567890', { content: 'x' }, { fetch })).toBe('ok')
    expect(fetch).toHaveBeenCalledOnce()
  })
})
