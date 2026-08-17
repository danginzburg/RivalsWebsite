import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { authorLabel } from '$lib/server/comments'
import { createNotification } from '$lib/server/notifications'
import { reviewEntityLink, type ReviewEntityType } from '$lib/server/review-flags'

type ProfileRow = {
  id: string
  display_name: string | null
  riot_id_base: string | null
  email: string | null
  role: string | null
}

type FlagRow = {
  id: string
  entity_type: ReviewEntityType
  entity_id: string
  reporter_profile_id: string
  reason: string
  status: string
  created_at: string
}

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Human label for a team relation Supabase may hand back as an object or array. */
function teamName(rel: unknown): string | null {
  const team = Array.isArray(rel) ? rel[0] : rel
  return (team as { name?: string | null } | null)?.name ?? null
}

export const GET: RequestHandler = async ({ locals, url }) => {
  await requireAdmin(locals.user)

  const status = url.searchParams.get('status') ?? 'pending'

  let query = supabaseAdmin
    .from('review_flags')
    .select('id, entity_type, entity_id, reporter_profile_id, reason, status, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  if (status !== 'all') query = query.eq('status', status)

  const { data: flags, error: flagsError } = await query
  if (flagsError) throw error(500, 'Failed to load flags')

  const rows = (flags ?? []) as FlagRow[]
  if (rows.length === 0) return json({ flags: [] })

  // Resolve reporter names in one batch.
  const reporterIds = Array.from(new Set(rows.map((r) => r.reporter_profile_id)))
  const { data: reporters } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, riot_id_base, email, role')
    .in('id', reporterIds)
  const reporterById = new Map<string, ProfileRow>(
    ((reporters ?? []) as ProfileRow[]).map((p) => [p.id, p])
  )

  // Build a readable label for each flagged entity.
  const matchIds = rows.filter((r) => r.entity_type === 'match').map((r) => r.entity_id)
  const playerIds = rows.filter((r) => r.entity_type === 'player').map((r) => r.entity_id)

  const matchLabelById = new Map<string, string>()
  if (matchIds.length > 0) {
    const { data: matchRows } = await supabaseAdmin
      .from('matches')
      .select(
        'id, scheduled_at, team_a:teams!matches_team_a_id_fkey(name), team_b:teams!matches_team_b_id_fkey(name)'
      )
      .in('id', Array.from(new Set(matchIds)))
    for (const m of matchRows ?? []) {
      const a = teamName((m as { team_a?: unknown }).team_a) ?? 'TBD'
      const b = teamName((m as { team_b?: unknown }).team_b) ?? 'TBD'
      matchLabelById.set((m as { id: string }).id, `${a} vs ${b}`)
    }
  }

  const playerLabelById = new Map<string, string>()
  if (playerIds.length > 0) {
    const { data: playerRows } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, riot_id_base, email, role')
      .in('id', Array.from(new Set(playerIds)))
    for (const p of (playerRows ?? []) as ProfileRow[]) {
      playerLabelById.set(p.id, authorLabel(p))
    }
  }

  return json({
    flags: rows.map((flag) => {
      const label =
        flag.entity_type === 'match'
          ? (matchLabelById.get(flag.entity_id) ?? 'Unknown match')
          : (playerLabelById.get(flag.entity_id) ?? 'Unknown player')
      return {
        id: flag.id,
        status: flag.status,
        reason: flag.reason,
        created_at: flag.created_at,
        entity_type: flag.entity_type,
        entity_id: flag.entity_id,
        entity_label: label,
        entity_link: reviewEntityLink(flag.entity_type, flag.entity_id),
        reporter: {
          id: flag.reporter_profile_id,
          name: authorLabel(reporterById.get(flag.reporter_profile_id)),
        },
      }
    }),
  })
}

export const PATCH: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const action = normalizeOptional(body.action)
  if (!action || !['resolve', 'dismiss'].includes(action)) {
    throw error(400, 'Unsupported action')
  }

  const flagId = normalizeOptional(body.flagId)
  if (!flagId) throw error(400, 'flagId is required')
  const reviewNotes = normalizeOptional(body.reviewNotes)

  const { data: flag, error: flagError } = await supabaseAdmin
    .from('review_flags')
    .update({
      status: action === 'resolve' ? 'resolved' : 'dismissed',
      reviewed_by_profile_id: admin.id,
      reviewed_at: new Date().toISOString(),
      review_notes: reviewNotes,
    })
    .eq('id', flagId)
    .select('id, entity_type, entity_id, reporter_profile_id')
    .maybeSingle()

  if (flagError) throw error(500, 'Failed to update flag')
  if (!flag) throw error(404, 'Flag not found')

  // Let the reporter know their flag was looked at.
  await createNotification({
    recipientProfileId: flag.reporter_profile_id,
    type: 'review_flag_resolved',
    title:
      action === 'resolve'
        ? 'The data you flagged has been reviewed'
        : 'Your data flag was reviewed',
    body: reviewNotes ? `Note from an admin: ${reviewNotes}` : null,
    link: reviewEntityLink(flag.entity_type as ReviewEntityType, flag.entity_id),
    actorProfileId: admin.id,
    entityType: flag.entity_type,
    entityId: flag.entity_id,
  })

  return json({ success: true })
}
