import { error, json, type RequestHandler } from '@sveltejs/kit'

import { assertCanParticipate, requireProfile } from '$lib/server/auth/profile'
import { enforceRateLimit } from '$lib/server/rate-limit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { parseForfeitMap, parseRegion } from '$lib/server/matches/riot-series'
import {
  applySubmission,
  captainTeamForMatch,
  evaluateSubmission,
  isMatchConcluded,
  loadReportableMatch,
  parseVetoText,
  saveMatchVeto,
} from '$lib/server/matches/reports'
import { inBackground, postAdminAlert } from '$lib/server/discord/announce'

const NOTE_MAX = 1000

/**
 * A captain's result submission from the match page: the veto log and the
 * tracker links for the series.
 *
 * The veto saves straight onto the match. The links are fetched and checked
 * against the match; a clean set imports at once, anything unusual is queued
 * for an admin (see `evaluateSubmission` for the rules). `dryRun` runs the same
 * checks and reports what would happen, writing nothing.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const profile = await requireProfile(locals.user)
  assertCanParticipate(profile)
  const isAdmin = profile.role === 'admin'

  const match = await loadReportableMatch(String(params.id ?? ''))
  const captainTeamId = await captainTeamForMatch(profile.id, match)
  if (!captainTeamId && !isAdmin) {
    throw error(403, "Only a captain of one of this match's teams can submit its results.")
  }
  if (!isMatchConcluded(match)) {
    throw error(400, 'Results can be submitted once the match has been played.')
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const dryRun = body.dryRun === true
  const trackerInput = typeof body.input === 'string' ? body.input.trim() : ''
  const vetoLines = parseVetoText(body.veto)
  const forfeitMap = parseForfeitMap(body.forfeitMap)
  const note =
    typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, NOTE_MAX) : null
  // The league plays on NA servers; a captain never picks a region.
  const region = parseRegion('na')

  if (!trackerInput && !forfeitMap) {
    if (vetoLines.length === 0) throw error(400, 'Paste the veto log or the tracker links.')
    if (dryRun) return json({ success: true, dryRun: true, vetoLines })
    await saveMatchVeto(match.id, vetoLines)
    return json({ success: true, outcome: 'veto_saved', vetoLines })
  }

  // Tighter than the admin budget: each map is a Riot request, and a captain
  // only ever needs a handful of tries for one match.
  const { series, reviewReasons } = await evaluateSubmission({
    match,
    trackerInput,
    region,
    forfeitMap,
    note,
    beforeFetch: () =>
      enforceRateLimit(`matches:report:${profile.id}`, {
        limit: 8,
        windowMs: 10 * 60_000,
        message: 'Too many submissions. Wait a few minutes and try again.',
      }),
  })

  if (dryRun) {
    return json({
      success: true,
      dryRun: true,
      preview: series.preview,
      vetoLines,
      reviewReasons,
      willApply: reviewReasons.length === 0,
    })
  }

  if (vetoLines.length > 0) await saveMatchVeto(match.id, vetoLines)

  const baseRow = {
    match_id: match.id,
    team_id: captainTeamId,
    submitted_by_profile_id: profile.id,
    tracker_input: trackerInput,
    region,
    veto_lines: vetoLines,
    forfeit_map: forfeitMap,
    note,
    preview: series.preview,
  }

  let status: 'applied' | 'pending' = reviewReasons.length === 0 ? 'applied' : 'pending'
  const reasons = [...reviewReasons]

  if (status === 'applied') {
    try {
      await applySubmission(match, series, profile.id)
    } catch (err) {
      // The submission itself was fine, so it goes to an admin rather than
      // back to the captain, who can't fix a server-side failure.
      console.error('Captain report auto-import failed:', err)
      status = 'pending'
      const message =
        err && typeof err === 'object' && 'body' in err
          ? String((err as { body?: { message?: string } }).body?.message ?? 'unknown error')
          : err instanceof Error
            ? err.message
            : 'unknown error'
      reasons.push(`The automatic import failed: ${message}`)
    }
  }

  const { data: report, error: insertError } = await supabaseAdmin
    .from('match_reports')
    .insert({ ...baseRow, status, review_reasons: reasons })
    .select('id, status, review_reasons, created_at')
    .single()
  if (insertError) {
    console.error('Failed to record captain report:', insertError)
    // Applied imports are already written; only a queued one is lost here.
    if (status === 'pending') throw error(500, 'Failed to save the submission. Try again.')
  }

  if (report && status === 'pending') {
    const reportId = report.id as string
    inBackground('match report alert', () =>
      postAdminAlert(reportId, {
        kind: 'match_report',
        submitter: profile.display_name ?? null,
        matchId: match.id,
        matchLabel: null,
        reasons,
      })
    )
  }

  return json({
    success: true,
    outcome: status,
    reportId: report?.id ?? null,
    reviewReasons: reasons,
    preview: series.preview,
  })
}
