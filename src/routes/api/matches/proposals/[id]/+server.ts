import type { RequestHandler } from '@sveltejs/kit'

// Match proposal operations disabled.
export const PATCH: RequestHandler = async () => new Response('Proposals disabled', { status: 404 })
