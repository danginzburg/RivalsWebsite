import { afterEach, describe, expect, it, vi } from 'vitest'

import { adminFormRequest, adminJsonRequest, fetchAdminDashboardData } from './api'

const originalFetch = globalThis.fetch

describe('admin api helpers', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('sends JSON requests and returns parsed JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    globalThis.fetch = fetchMock as typeof fetch

    await expect(
      adminJsonRequest('/api/admin/users', {
        method: 'PATCH',
        body: { userId: '123', riotIdBase: 'Alpha#NA1' },
        fallbackMessage: 'Failed to update Riot ID',
      })
    ).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: '123', riotIdBase: 'Alpha#NA1' }),
    })
  })

  it('uses text fallback for form errors when json parsing fails', async () => {
    const form = new FormData()
    form.set('name', 'Phoenix')

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Bad upload', {
        status: 400,
        headers: { 'Content-Type': 'text/plain' },
      })
    ) as typeof fetch

    await expect(
      adminFormRequest('/api/admin/teams', {
        method: 'POST',
        body: form,
        fallbackMessage: 'Failed to create team',
        includeHttpStatusInError: true,
      })
    ).rejects.toThrow('Bad upload')
  })

  it('fetches dashboard resources and returns grouped data', async () => {
    const responses = [
      { users: [{ id: 'u1' }] },
      { seasons: [{ id: 's1' }] },
      { queue: [{ id: 'q1' }], approved: [{ id: 't1' }] },
      { matches: [{ id: 'm1' }] },
    ]

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(responses[0])))
      .mockResolvedValueOnce(new Response(JSON.stringify(responses[1])))
      .mockResolvedValueOnce(new Response(JSON.stringify(responses[2])))
      .mockResolvedValueOnce(new Response(JSON.stringify(responses[3]))) as typeof fetch

    await expect(fetchAdminDashboardData()).resolves.toEqual({
      users: [{ id: 'u1' }],
      seasons: [{ id: 's1' }],
      queue: [{ id: 'q1' }],
      approved: [{ id: 't1' }],
      matches: [{ id: 'm1' }],
    })
  })
})
