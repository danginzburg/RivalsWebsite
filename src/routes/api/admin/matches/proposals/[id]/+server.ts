import type { RequestHandler } from '@sveltejs/kit'

// Admin proposal actions disabled — scheduling removed.
export const PATCH: RequestHandler = async () =>
  new Response('Admin proposals disabled', { status: 404 })
