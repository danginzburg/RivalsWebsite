import type { RequestHandler } from '@sveltejs/kit'

// Veto API disabled — feature removed.
export const GET: RequestHandler = async () => new Response('Veto removed', { status: 404 })
export const POST: RequestHandler = async () => new Response('Veto removed', { status: 404 })
export const DELETE: RequestHandler = async () => new Response('Veto removed', { status: 404 })
