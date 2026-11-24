import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireProfile, assertCanParticipate } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { enforceRateLimit } from '$lib/server/rate-limit'
import { normalizeBugDescription, normalizeBugPagePath } from '$lib/server/bug-reports'
import { inBackground, postAdminAlert } from '$lib/server/discord/announce'

export const POST: RequestHandler = async ({ request, locals }) => {
  const profile = await requireProfile(locals.user)
  assertCanParticipate(profile)

  const body = await request.json().catch(() => ({}))
  const description = normalizeBugDescription(body.description)
  const pagePath = normalizeBugPagePath(body.pagePath)

  await enforceRateLimit(`bug-report:${profile.id}`, {
    limit: 5,
    windowMs: 60_000,
    message: 'You are submitting reports too quickly. Please wait a moment.',
  })

  const { data: report, error: insertError } = await supabaseAdmin
    .from('bug_reports')
    .insert({
      reporter_profile_id: profile.id,
      page_path: pagePath,
      description,
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('Failed to create bug report:', insertError)
    throw error(500, 'Failed to submit bug report')
  }

  inBackground('bug report alert', () =>
    postAdminAlert(report.id as string, {
      kind: 'bug_report',
      reporter: profile.display_name ?? null,
      pagePath,
      description,
    })
  )

  return json({ success: true })
}
