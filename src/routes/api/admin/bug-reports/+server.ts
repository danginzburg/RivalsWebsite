import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { authorLabel } from '$lib/server/comments'
import { createNotification } from '$lib/server/notifications'

type ProfileRow = {
  id: string
  display_name: string | null
  riot_id_base: string | null
  email: string | null
  role: string | null
}

type BugReportRow = {
  id: string
  reporter_profile_id: string
  page_path: string | null
  description: string
  status: string
  created_at: string
}

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const GET: RequestHandler = async ({ locals, url }) => {
  await requireAdmin(locals.user)

  const status = url.searchParams.get('status') ?? 'pending'

  let query = supabaseAdmin
    .from('bug_reports')
    .select('id, reporter_profile_id, page_path, description, status, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  if (status !== 'all') query = query.eq('status', status)

  const { data: reports, error: reportsError } = await query
  if (reportsError) throw error(500, 'Failed to load bug reports')

  const rows = (reports ?? []) as BugReportRow[]
  if (rows.length === 0) return json({ reports: [] })

  // Resolve reporter names in one batch.
  const reporterIds = Array.from(new Set(rows.map((r) => r.reporter_profile_id)))
  const { data: reporters } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, riot_id_base, email, role')
    .in('id', reporterIds)
  const reporterById = new Map<string, ProfileRow>(
    ((reporters ?? []) as ProfileRow[]).map((p) => [p.id, p])
  )

  return json({
    reports: rows.map((report) => ({
      id: report.id,
      status: report.status,
      description: report.description,
      page_path: report.page_path,
      created_at: report.created_at,
      reporter: {
        id: report.reporter_profile_id,
        name: authorLabel(reporterById.get(report.reporter_profile_id)),
      },
    })),
  })
}

export const PATCH: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const action = normalizeOptional(body.action)
  if (!action || !['resolve', 'dismiss'].includes(action)) {
    throw error(400, 'Unsupported action')
  }

  const reportId = normalizeOptional(body.reportId)
  if (!reportId) throw error(400, 'reportId is required')
  const reviewNotes = normalizeOptional(body.reviewNotes)

  const { data: report, error: reportError } = await supabaseAdmin
    .from('bug_reports')
    .update({
      status: action === 'resolve' ? 'resolved' : 'dismissed',
      reviewed_by_profile_id: admin.id,
      reviewed_at: new Date().toISOString(),
      review_notes: reviewNotes,
    })
    .eq('id', reportId)
    .select('id, reporter_profile_id, page_path')
    .maybeSingle()

  if (reportError) throw error(500, 'Failed to update bug report')
  if (!report) throw error(404, 'Bug report not found')

  // Let the reporter know their report was looked at.
  await createNotification({
    recipientProfileId: report.reporter_profile_id,
    type: 'bug_report_resolved',
    title:
      action === 'resolve'
        ? 'The bug you reported has been reviewed'
        : 'Your bug report was reviewed',
    body: reviewNotes ? `Note from an admin: ${reviewNotes}` : null,
    link: report.page_path,
    actorProfileId: admin.id,
  })

  return json({ success: true })
}
