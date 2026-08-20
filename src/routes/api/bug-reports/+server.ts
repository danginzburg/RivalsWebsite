import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireProfile, assertCanParticipate } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { enforceRateLimit } from '$lib/server/rate-limit'
import { normalizeBugDescription, normalizeBugPagePath } from '$lib/server/bug-reports'

export const POST: RequestHandler = async ({ request, locals }) => {
  const profile = await requireProfile(locals.user)
  assertCanParticipate(profile)

  const body = await request.json().catch(() => ({}))
  const description = normalizeBugDescription(body.description)
  const pagePath = normalizeBugPagePath(body.pagePath)

  enforceRateLimit(`bug-report:${profile.id}`, {
    limit: 5,
    windowMs: 60_000,
    message: 'You are submitting reports too quickly. Please wait a moment.',
  })

  const { error: insertError } = await supabaseAdmin.from('bug_reports').insert({
    reporter_profile_id: profile.id,
    page_path: pagePath,
    description,
  })

  if (insertError) {
    console.error('Failed to create bug report:', insertError)
    throw error(500, 'Failed to submit bug report')
  }

  return json({ success: true })
}
