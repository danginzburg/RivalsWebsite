import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { MatchLifecycleError, reviewResultReport } from '$lib/server/matches/lifecycle'
import { supabaseAdmin } from '$lib/supabase/admin'
import { createNotification } from '$lib/server/notifications'

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

    // Notify whoever filed the report that it has been resolved.
    const { data: report } = await supabaseAdmin
      .from('match_result_reports')
      .select('match_id, reported_by_profile_id')
      .eq('id', reportId)
      .maybeSingle()

    if (report?.reported_by_profile_id) {
      await createNotification({
        recipientProfileId: report.reported_by_profile_id,
        type: 'result_report_resolved',
        title:
          action === 'approve'
            ? 'Your match result report was approved'
            : 'Your match result report was rejected',
        body: reviewNotes ? `Note from an admin: ${reviewNotes}` : null,
        link: `/matches/${report.match_id}`,
        actorProfileId: admin.id,
        entityType: 'match',
        entityId: report.match_id,
      })
    }

    return json({ success: true, ...result })
  } catch (err) {
    if (err instanceof MatchLifecycleError) throw error(err.status, err.message)
    throw err
  }
}
