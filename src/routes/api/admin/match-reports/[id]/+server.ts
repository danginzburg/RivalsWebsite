import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { createNotification } from '$lib/server/notifications'
import { parseRegion } from '$lib/server/matches/riot-series'
import {
  applySubmission,
  evaluateSubmission,
  loadReportableMatch,
  MATCH_REPORT_SELECT,
  type MatchReportRow,
} from '$lib/server/matches/reports'

/**
 * Approve or reject a captain result submission that was held for review.
 *
 * Approving re-fetches the submitted links and imports them onto the match —
 * the same write an automatic submission makes — with the hand-entered forfeit
 * map, if any. The reasons it was held are not re-checked: the admin has read
 * them and is overriding. Anything the admin wants changed first (other links,
 * a different forfeit) goes through the full importer instead.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const action = body.action === 'approve' || body.action === 'reject' ? body.action : null
  if (!action) throw error(400, 'action must be approve or reject')
  const reviewNote =
    typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : null

  const { data, error: loadError } = await supabaseAdmin
    .from('match_reports')
    .select(MATCH_REPORT_SELECT)
    .eq('id', String(params.id ?? ''))
    .maybeSingle()
  if (loadError) throw error(500, 'Failed to load the submission')
  if (!data) throw error(404, 'Submission not found')
  const report = data as unknown as MatchReportRow
  if (report.status !== 'pending') throw error(409, 'This submission has already been reviewed.')

  if (action === 'approve') {
    const match = await loadReportableMatch(report.match_id)
    const { series } = await evaluateSubmission({
      match,
      trackerInput: report.tracker_input,
      region: parseRegion(report.region),
      forfeitMap: report.forfeit_map,
      note: report.note,
    })
    await applySubmission(match, series, admin.id)
  }

  const { error: updateError } = await supabaseAdmin
    .from('match_reports')
    .update({
      status: action === 'approve' ? 'applied' : 'rejected',
      reviewed_by_profile_id: admin.id,
      reviewed_at: new Date().toISOString(),
      review_note: reviewNote,
      updated_at: new Date().toISOString(),
    })
    .eq('id', report.id)
  if (updateError) throw error(500, 'Failed to update the submission')

  if (report.submitted_by_profile_id) {
    await createNotification({
      recipientProfileId: report.submitted_by_profile_id,
      type: 'result_report_resolved',
      title:
        action === 'approve'
          ? 'Your match results were approved'
          : 'Your match results submission was rejected',
      body: reviewNote ? `Note from an admin: ${reviewNote}` : null,
      link: `/matches/${report.match_id}`,
      actorProfileId: admin.id,
      entityType: 'match',
      entityId: report.match_id,
    })
  }

  return json({ success: true, status: action === 'approve' ? 'applied' : 'rejected' })
}
