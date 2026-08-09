import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'

const ENTRY_TYPES = ['record', 'moment', 'award'] as const

const SELECT_COLUMNS = `
  id,
  entry_type,
  title,
  description,
  stat_value,
  stat_label,
  media_url,
  player_name,
  profile_id,
  team_id,
  season_id,
  is_published,
  sort_order,
  created_at
`

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseEntryType(value: unknown): (typeof ENTRY_TYPES)[number] {
  const raw = normalizeOptional(value) ?? 'record'
  if (!(ENTRY_TYPES as readonly string[]).includes(raw)) {
    throw error(400, `entryType must be one of ${ENTRY_TYPES.join(', ')}`)
  }
  return raw as (typeof ENTRY_TYPES)[number]
}

/** Shared field mapping for create and update. */
function buildRow(body: Record<string, unknown>) {
  const title = normalizeOptional(body.title)
  if (!title) throw error(400, 'Title is required')

  return {
    entry_type: parseEntryType(body.entryType),
    title,
    description: normalizeOptional(body.description),
    stat_value: normalizeOptional(body.statValue),
    stat_label: normalizeOptional(body.statLabel),
    media_url: normalizeOptional(body.mediaUrl),
    player_name: normalizeOptional(body.playerName),
    profile_id: normalizeOptional(body.profileId),
    team_id: normalizeOptional(body.teamId),
    season_id: normalizeOptional(body.seasonId),
    is_published: body.isPublished === undefined ? true : Boolean(body.isPublished),
    sort_order: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
  }
}

export const GET: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals.user)

  const { data, error: listError } = await supabaseAdmin
    .from('hall_of_fame_entries')
    .select(SELECT_COLUMNS)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })

  if (listError) throw error(500, 'Failed to load hall of fame entries')

  return json({ entries: data ?? [] })
}

export const POST: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const { data, error: insertError } = await supabaseAdmin
    .from('hall_of_fame_entries')
    .insert({ ...buildRow(body), created_by_profile_id: admin.id })
    .select(SELECT_COLUMNS)
    .single()

  if (insertError) throw error(500, 'Failed to create hall of fame entry')

  return json({ success: true, entry: data })
}

export const PATCH: RequestHandler = async ({ locals, request }) => {
  await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const id = normalizeOptional(body.id)
  if (!id) throw error(400, 'Entry id is required')

  const { data, error: updateError } = await supabaseAdmin
    .from('hall_of_fame_entries')
    .update(buildRow(body))
    .eq('id', id)
    .select(SELECT_COLUMNS)
    .single()

  if (updateError) throw error(500, 'Failed to update hall of fame entry')

  return json({ success: true, entry: data })
}

export const DELETE: RequestHandler = async ({ locals, url }) => {
  await requireAdmin(locals.user)

  const id = url.searchParams.get('id')
  if (!id) throw error(400, 'Entry id is required')

  const { error: deleteError } = await supabaseAdmin
    .from('hall_of_fame_entries')
    .delete()
    .eq('id', id)

  if (deleteError) throw error(500, 'Failed to delete hall of fame entry')

  return json({ success: true })
}
