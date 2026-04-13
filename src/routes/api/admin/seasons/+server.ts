import { error, json, type RequestHandler } from '@sveltejs/kit'

import {
  getLeaderboardRowsForBatch,
  listLeaderboardBatches,
  normalizePickemConfig,
  pickemConfigFromSeasonMetadata,
  validatePickemBaseline,
} from '$lib/server/pickems'
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
    .select('id, code, name, starts_on, ends_on, is_active, metadata, created_at')
    .order('is_active', { ascending: false })
    .order('starts_on', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (seasonsError) throw error(500, 'Failed to load seasons')
  return Promise.all(
    (data ?? []).map(async (season) => {
      const pickem = pickemConfigFromSeasonMetadata(season.metadata)
      if (!pickem.leaderboard_batch_id) {
        return {
          ...season,
          pickem,
          pickem_preview_rows: [],
          pickem_preview_error: null,
        }
      }

      try {
        const rows = (await getLeaderboardRowsForBatch(pickem.leaderboard_batch_id)).slice(
          0,
          pickem.participant_count
        )
        validatePickemBaseline(rows, pickem.participant_count, pickem.baseline_completed_rounds)
        return {
          ...season,
          pickem,
          pickem_preview_rows: rows.map((row) => ({
            team_id: row.team?.id ?? null,
            wins: row.wins,
            losses: row.losses,
            round_diff: row.round_diff,
          })),
          pickem_preview_error: null,
        }
      } catch (previewError) {
        return {
          ...season,
          pickem,
          pickem_preview_rows: [],
          pickem_preview_error:
            previewError instanceof Error
              ? previewError.message
              : 'Failed to validate pickem batch',
        }
      }
    })
  )
}

export const GET: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals.user)
  const [seasons, leaderboardBatches] = await Promise.all([
    listSeasons(),
    listLeaderboardBatches(50),
  ])
  return json({ seasons, leaderboardBatches })
}

export const POST: RequestHandler = async ({ locals, request }) => {
  await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))

  const code = normalizeOptional(body.code)
  const name = normalizeOptional(body.name)
  const startsOn = normalizeOptional(body.startsOn)
  const endsOn = normalizeOptional(body.endsOn)
  const isActive = Boolean(body.isActive)
  const pickem = normalizePickemConfig(body.pickem)

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
      metadata: {
        pickem,
      },
    })
    .select('id, code, name, starts_on, ends_on, is_active, metadata, created_at')
    .single()

  if (insertError) {
    if (insertError.code === '23505') throw error(409, 'Season code already exists')
    throw error(500, 'Failed to create season')
  }

  return json({
    success: true,
    season: { ...data, pickem: normalizePickemConfig(data.metadata?.pickem) },
  })
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
  const pickem = normalizePickemConfig(body.pickem)

  if (!id) throw error(400, 'Season id is required')
  if (!code) throw error(400, 'Season code is required')
  if (!name) throw error(400, 'Season name is required')

  if (isActive) {
    await supabaseAdmin.from('seasons').update({ is_active: false }).neq('id', id)
  }

  const { data: existingSeason, error: existingSeasonError } = await supabaseAdmin
    .from('seasons')
    .select('metadata')
    .eq('id', id)
    .maybeSingle()

  if (existingSeasonError || !existingSeason) throw error(404, 'Season not found')

  const { data, error: updateError } = await supabaseAdmin
    .from('seasons')
    .update({
      code,
      name,
      starts_on: startsOn,
      ends_on: endsOn,
      is_active: isActive,
      metadata: {
        ...((existingSeason.metadata as Record<string, unknown> | null) ?? {}),
        pickem,
      },
    })
    .eq('id', id)
    .select('id, code, name, starts_on, ends_on, is_active, metadata, created_at')
    .single()

  if (updateError) {
    if (updateError.code === '23505') throw error(409, 'Season code already exists')
    throw error(500, 'Failed to update season')
  }

  return json({
    success: true,
    season: { ...data, pickem: normalizePickemConfig(data.metadata?.pickem) },
  })
}
