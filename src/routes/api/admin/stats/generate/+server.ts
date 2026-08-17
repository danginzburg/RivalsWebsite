import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { logAdminAction } from '$lib/server/audit/admin-actions'
import {
  generateStatsBatchFromMatches,
  regenerateStatsBatch,
  selectMatchesForStages,
} from '$lib/server/stats/from-matches'
import { normalizeSectionKey, type SectionKey } from '$lib/stats/sections'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseStages(value: unknown): SectionKey[] {
  if (!Array.isArray(value)) return []
  const keys = value.map((v) => normalizeSectionKey(v)).filter((v): v is SectionKey => v !== null)
  return Array.from(new Set(keys))
}

function parseSeasonId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!UUID_RE.test(trimmed)) throw error(400, 'Invalid seasonId')
  return trimmed
}

/**
 * How many approved matches sit in each stage, so the generator can show what a
 * given season/stage selection would actually pull in before it is run.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  await requireAdmin(locals.user)

  const seasonId = parseSeasonId(url.searchParams.get('seasonId'))
  const { countsByStage } = await selectMatchesForStages({ seasonId, stages: [] })

  return json({ seasonId, countsByStage })
}

export const POST: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const action = typeof body.action === 'string' ? body.action.trim() : 'generate'

  try {
    if (action === 'regenerate') {
      const batchId = typeof body.batchId === 'string' ? body.batchId.trim() : ''
      if (!UUID_RE.test(batchId)) throw error(400, 'Invalid batchId')

      const result = await regenerateStatsBatch({ batchId, adminProfileId: admin.id })

      await logAdminAction({
        adminProfileId: admin.id,
        actionType: 'stat_batch_regenerated',
        targetTable: 'stat_import_batches',
        targetId: result.batchId,
        details: { playerCount: result.playerCount, matchCount: result.matchCount },
      })

      return json({ success: true, ...result })
    }

    if (action !== 'generate') throw error(400, 'Unsupported action')

    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''
    if (!displayName) throw error(400, 'A batch name is required')
    if (displayName.length > 120) throw error(400, 'That batch name is too long')

    const stages = parseStages(body.stages)
    const seasonId = parseSeasonId(body.seasonId)
    const section = normalizeSectionKey(body.section)
    const autoRefresh = body.autoRefresh !== false

    // An unscoped batch sweeps up every season at once — which is how a
    // "Match Imports (live)" batch spanning all of history gets made by
    // accident. A season is cheap to pick and makes the scope obvious.
    if (!seasonId) throw error(400, 'Pick a season — a batch spanning every season is never wanted')

    const sortOrderRaw = body.sortOrder
    const hasSortOrder =
      sortOrderRaw !== undefined && sortOrderRaw !== null && String(sortOrderRaw).trim() !== ''
    const sortOrder = hasSortOrder ? Number(sortOrderRaw) : null
    if (hasSortOrder && !Number.isFinite(sortOrder)) throw error(400, 'sortOrder must be a number')

    const result = await generateStatsBatchFromMatches({
      seasonId,
      stages,
      section,
      displayName,
      sortOrder,
      autoRefresh,
      adminProfileId: admin.id,
    })

    await logAdminAction({
      adminProfileId: admin.id,
      actionType: 'stat_batch_generated',
      targetTable: 'stat_import_batches',
      targetId: result.batchId,
      details: {
        displayName,
        seasonId,
        stages,
        section,
        autoRefresh,
        playerCount: result.playerCount,
        matchCount: result.matchCount,
      },
    })

    return json({ success: true, ...result })
  } catch (err) {
    // Kit's `error()` throws an object with a `status`; anything else is a
    // generation failure whose message is written for an admin to act on.
    if (typeof err === 'object' && err !== null && 'status' in err) throw err
    throw error(400, err instanceof Error ? err.message : 'Failed to generate batch')
  }
}
