import { error, json, type RequestHandler } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { syncCompetitiveMapPools } from '$lib/server/seasons/competitive-map-pool'

/*
 * Daily (vercel.json): adds any newly rotated-in ranked maps to seasons whose
 * map pool follows the competitive rotation. Maps are never removed. Vercel
 * Cron sends `Authorization: Bearer $CRON_SECRET`.
 */
export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    throw error(401, 'Unauthorized')
  }

  const result = await syncCompetitiveMapPools()
  return json({ ok: true, ...result })
}
