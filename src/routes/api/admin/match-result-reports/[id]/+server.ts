import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { logAdminAction } from '$lib/server/audit/admin-actions'
import { supabaseAdmin } from '$lib/supabase/admin'

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

  const { data: report, error: reportError } = await supabaseAdmin
    .from('match_result_reports')
    .select(
      'id, match_id, status, team_a_score, team_b_score, winner_team_id, reporting_team_id, reported_by_profile_id'
    )
    .eq('id', reportId)
    .single()

  if (reportError || !report) throw error(404, 'Result report not found')
  if (report.status !== 'pending') throw error(409, 'Result report is not pending')

  const { data: match, error: matchError } = await supabaseAdmin
    .from('matches')
    .select('id, status, approval_status, team_a_id, team_b_id')
    .eq('id', report.match_id)
    .single()

  if (matchError || !match) throw error(404, 'Match not found')
  if (match.approval_status !== 'approved') throw error(409, 'Match is not approved')
  if (['completed', 'cancelled'].includes(match.status))
    throw error(409, 'Match is already finished')

  if (![match.team_a_id, match.team_b_id].includes(report.winner_team_id)) {
    throw error(400, 'Invalid winner team on report')
  }

  if (action === 'reject') {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('match_result_reports')
      .update({
        status: 'rejected',
        reviewed_by_profile_id: admin.id,
        reviewed_at: new Date().toISOString(),
        review_notes: reviewNotes,
      })
      .eq('id', reportId)
      .select('id, status')
      .single()

    if (updateError || !updated) throw error(500, 'Failed to reject result report')

    await logAdminAction({
      adminProfileId: admin.id,
      actionType: 'match_result_report_rejected',
      targetTable: 'match_result_reports',
      targetId: reportId,
      details: { match_id: report.match_id, review_notes: reviewNotes },
    })

    return json({ success: true, report: updated })
  }

  // Approve: finalize match + mark report approved.
  const { data: updatedMatch, error: matchUpdateError } = await supabaseAdmin
    .from('matches')
    .update({
      status: 'completed',
      approval_status: 'approved',
      winner_team_id: report.winner_team_id,
      team_a_score: report.team_a_score,
      team_b_score: report.team_b_score,
      ended_at: new Date().toISOString(),
      approved_by_profile_id: admin.id,
      approved_at: new Date().toISOString(),
    })
    .eq('id', report.match_id)
    .select('id, status, winner_team_id, team_a_score, team_b_score')
    .single()

  if (matchUpdateError || !updatedMatch) throw error(500, 'Failed to finalize match')

  const { data: updatedReport, error: reportUpdateError } = await supabaseAdmin
    .from('match_result_reports')
    .update({
      status: 'approved',
      reviewed_by_profile_id: admin.id,
      reviewed_at: new Date().toISOString(),
      review_notes: reviewNotes,
    })
    .eq('id', reportId)
    .select('id, status')
    .single()

  if (reportUpdateError || !updatedReport) throw error(500, 'Failed to update result report')

  await logAdminAction({
    adminProfileId: admin.id,
    actionType: 'match_result_report_approved',
    targetTable: 'match_result_reports',
    targetId: reportId,
    details: {
      match_id: report.match_id,
      winner_team_id: report.winner_team_id,
      team_a_score: report.team_a_score,
      team_b_score: report.team_b_score,
      review_notes: reviewNotes,
    },
  })

  return json({ success: true, match: updatedMatch, report: updatedReport })
}
