import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { enforceRateLimit } from '$lib/server/rate-limit'
import { TrackerError, lookupTrackerScore } from '$lib/server/tracker/client'
import { fetchAccount, fetchRank, parseRiotId } from '$lib/server/riot/henrik'

/**
 * Read a player's tracker.gg performance score.
 *
 * Admin-only and tightly rate limited: each lookup fans out to several
 * requests against a third-party service that discourages automation, so this
 * is never reachable from the public signup form.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const admin = await requireAdmin(locals.user)

  const riotId = url.searchParams.get('riotId')?.trim()
  if (!riotId) throw error(400, 'riotId is required')

  enforceRateLimit(`tracker:lookup:${admin.id}`, {
    limit: 6,
    windowMs: 60_000,
    message: 'Too many tracker lookups. Wait a minute before trying again.',
  })

  // The peak tracker score should come from the act the player peaked in, so
  // resolve that act from the Riot MMR API first. Both services key acts by
  // Riot's season UUID. A failure here is not fatal — the tracker lookup then
  // falls back to the highest recent score.
  let peakActId: string | null = null
  let peakRankLabel: string | null = null
  try {
    const { name, tag } = parseRiotId(riotId)
    const account = await fetchAccount(name, tag)
    const rank = await fetchRank(account.name, account.tag, account.region)
    peakActId = rank.peakSeasonId
    peakRankLabel = rank.peakTier
  } catch {
    // Leave peakActId null and let the tracker lookup infer a peak.
  }

  try {
    const result = await lookupTrackerScore(riotId, { peakActId })
    return json({
      success: true,
      handle: result.handle,
      current: result.current && {
        act: result.current.actShortName,
        score: result.current.score,
      },
      peak: result.peak && { act: result.peak.actShortName, score: result.peak.score },
      peakSource: result.peakSource,
      peakRank: peakRankLabel,
      scanned: result.scanned,
      warning: [result.peakWarning, result.verificationWarning].filter(Boolean).join(' ') || null,
    })
  } catch (err) {
    if (err instanceof TrackerError) throw error(err.status, err.message)
    throw err
  }
}
