import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseScheduledAt(value: unknown): string | null {
  const raw = normalizeOptional(value)
  if (!raw) return null

  // Support <input type="datetime-local"> value (YYYY-MM-DDTHH:mm)
  const looksLikeLocal = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)
  const asIso = looksLikeLocal ? `${raw}:00Z` : raw
  const d = new Date(asIso)
  if (!Number.isFinite(d.getTime())) {
    throw error(400, 'Invalid scheduledAt')
  }
  return d.toISOString()
}

export const GET: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals.user)

  const { data: matches, error: matchesError } = await supabaseAdmin
    .from('matches')
    .select(
      `
      id,
      status,
      approval_status,
      best_of,
      scheduled_at,
      team_a_id,
      team_b_id,
      winner_team_id,
      team_a_score,
      team_b_score,
      team_a:teams!matches_team_a_id_fkey (id, name, tag),
      team_b:teams!matches_team_b_id_fkey (id, name, tag)
    `
    )
    .order('created_at', { ascending: false })

  if (matchesError) throw error(500, 'Failed to load matches')

  return json({ matches: matches ?? [] })
}

export const POST: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const teamAId = normalizeOptional(body.teamAId)
  const teamBId = normalizeOptional(body.teamBId)
  const bestOf = Number(body.bestOf ?? 3)
  const scheduledAt = parseScheduledAt(body.scheduledAt)

  if (!teamAId || !teamBId) throw error(400, 'teamAId and teamBId are required')
  if (teamAId === teamBId) throw error(400, 'Teams must be different')
  if (![1, 3, 5, 7].includes(bestOf)) throw error(400, 'bestOf must be one of 1, 3, 5, 7')

  const { data: teams, error: teamsError } = await supabaseAdmin
    .from('teams')
    .select('id, approval_status')
    .in('id', [teamAId, teamBId])

  if (teamsError) throw error(500, 'Failed to validate teams')
  if ((teams ?? []).length !== 2) throw error(400, 'One or more teams not found')
  if ((teams ?? []).some((t: any) => t.approval_status !== 'approved')) {
    throw error(400, 'Both teams must be approved')
  }

  const now = new Date().toISOString()
  const { data: created, error: createError } = await supabaseAdmin
    .from('matches')
    .insert({
      status: 'scheduled',
      approval_status: 'approved',
      best_of: bestOf,
      scheduled_at: scheduledAt,
      team_a_id: teamAId,
      team_b_id: teamBId,
      submitted_by_profile_id: admin.id,
      approved_by_profile_id: admin.id,
      approved_at: now,
    })
    .select(
      `
      id,
      status,
      approval_status,
      best_of,
      scheduled_at,
      team_a_id,
      team_b_id,
      winner_team_id,
      team_a_score,
      team_b_score,
      team_a:teams!matches_team_a_id_fkey (id, name, tag),
      team_b:teams!matches_team_b_id_fkey (id, name, tag)
    `
    )
    .single()

  if (createError || !created) throw error(500, 'Failed to create match')

  return json({ success: true, match: created })
}
