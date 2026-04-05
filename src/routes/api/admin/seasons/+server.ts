import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function listSeasons() {
  const { data, error: seasonsError } = await supabaseAdmin
    .from('seasons')
    .select('id, code, name, starts_on, ends_on, is_active, created_at')
    .order('is_active', { ascending: false })
    .order('starts_on', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (seasonsError) throw error(500, 'Failed to load seasons')
  return data ?? []
}

export const GET: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals.user)
  return json({ seasons: await listSeasons() })
}

export const POST: RequestHandler = async ({ locals, request }) => {
  await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const code = normalizeOptional(body.code)
  const name = normalizeOptional(body.name)
  const startsOn = normalizeOptional(body.startsOn)
  const endsOn = normalizeOptional(body.endsOn)
  const isActive = Boolean(body.isActive)

  if (!code) throw error(400, 'Season code is required')
  if (!name) throw error(400, 'Season name is required')

  if (isActive) {
    await supabaseAdmin
      .from('seasons')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000')
  }

  const { data, error: insertError } = await supabaseAdmin
    .from('seasons')
    .insert({
      code,
      name,
      starts_on: startsOn,
      ends_on: endsOn,
      is_active: isActive,
    })
    .select('id, code, name, starts_on, ends_on, is_active, created_at')
    .single()

  if (insertError) {
    if (insertError.code === '23505') throw error(409, 'Season code already exists')
    throw error(500, 'Failed to create season')
  }

  return json({ success: true, season: data })
}

export const PATCH: RequestHandler = async ({ locals, request }) => {
  await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const id = normalizeOptional(body.id)
  const code = normalizeOptional(body.code)
  const name = normalizeOptional(body.name)
  const startsOn = normalizeOptional(body.startsOn)
  const endsOn = normalizeOptional(body.endsOn)
  const isActive = Boolean(body.isActive)

  if (!id) throw error(400, 'Season id is required')
  if (!code) throw error(400, 'Season code is required')
  if (!name) throw error(400, 'Season name is required')

  if (isActive) {
    await supabaseAdmin.from('seasons').update({ is_active: false }).neq('id', id)
  }

  const { data, error: updateError } = await supabaseAdmin
    .from('seasons')
    .update({
      code,
      name,
      starts_on: startsOn,
      ends_on: endsOn,
      is_active: isActive,
    })
    .eq('id', id)
    .select('id, code, name, starts_on, ends_on, is_active, created_at')
    .single()

  if (updateError) {
    if (updateError.code === '23505') throw error(409, 'Season code already exists')
    throw error(500, 'Failed to update season')
  }

  return json({ success: true, season: data })
}
