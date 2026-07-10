import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { MatchLifecycleError, reviewResultReport } from '$lib/server/matches/lifecycle'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  const admin = await requireAdmin(locals.user)
  const reportId = params.id
  if (!reportId) throw error(400, 'Missing report id')

  const body = await request.json()
  const action = normalizeOptional(body.action)
  const reviewNotes = normalizeOptional(body.reviewNotes)
  if (!action) throw error(400, 'Missing action')
  if (!['approve', 'reject'].includes(action)) throw error(400, 'Unsupported action')

  try {
    const result = await reviewResultReport({
      reportId,
      adminProfileId: admin.id,
      action: action as 'approve' | 'reject',
      reviewNotes,
    })
    return json({ success: true, ...result })
  } catch (err) {
    if (err instanceof MatchLifecycleError) throw error(err.status, err.message)
    throw err
  }
}
