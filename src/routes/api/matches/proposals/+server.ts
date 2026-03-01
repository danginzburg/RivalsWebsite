import { json, type RequestHandler } from '@sveltejs/kit'

// Match proposal endpoints disabled: proposals listing will return empty; creation disabled.

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const GET: RequestHandler = async () => json({ proposals: [] })
export const POST: RequestHandler = async () => new Response('Proposals disabled', { status: 404 })
