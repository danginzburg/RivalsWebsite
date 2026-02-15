import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'
import { requireAdmin } from '$lib/server/auth/profile'

export const POST: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)

  const body = await request.json()
  const rows = body?.rows

  if (!Array.isArray(rows) || rows.length === 0) {
    throw error(400, 'No rows provided')
  }

  const MAX_ROWS = 1000
  if (rows.length > MAX_ROWS) {
    throw error(400, `Too many rows provided; maximum is ${MAX_ROWS}`)
  }
  const { data: registrations, error: registrationsError } = await supabaseAdmin
    .from('player_registration')
    .select(
      `
        profile_id,
        riot_id,
        profiles!player_registration_profile_id_fkey (
          display_name
        )
      `
    )

  if (registrationsError) {
    console.error('Error fetching player registrations:', registrationsError)
    throw error(500, 'Failed to fetch player registrations: ' + registrationsError.message)
  }
  // Fetch registered players for server-side matching (case-insensitive)
  const { data: registrations } = await supabaseAdmin.from('player_registration').select(
    `
        profile_id,
        riot_id,
        profiles!player_registration_profile_id_fkey (
          display_name
        )
      `
  )

  const normalizeKey = (value: string) => value.trim().toLowerCase()
  const normalizeBase = (value: string) => value.split('#')[0]?.trim().toLowerCase()

  const profileMap = new Map<string, string>()
  for (const reg of registrations ?? []) {
    const profileRel = Array.isArray(reg.profiles) ? reg.profiles[0] : reg.profiles
    const displayName = profileRel?.display_name
    if (displayName) {
      const full = normalizeKey(displayName)
      const base = normalizeBase(displayName)
      profileMap.set(full, reg.profile_id)
      if (base && base !== full) {
        profileMap.set(base, reg.profile_id)
      }
    }
    if (reg.riot_id) {
      const base = normalizeBase(reg.riot_id)
      if (base) {
        profileMap.set(base, reg.profile_id)
      }
    }
  }

  // Build insert rows with server-side profile matching
  let matched = 0
  let unmatched = 0

  const insertRows = rows.map((row: any) => {
    const profileId = row.player_name
      ? (profileMap.get(normalizeKey(row.player_name)) ??
        profileMap.get(normalizeBase(row.player_name)) ??
        null)
      : null
    if (profileId) {
      matched++
    } else {
      unmatched++
    }

    return {
      player_name: row.player_name,
      profile_id: profileId,
      agents: row.agents ?? null,
      games: row.games ?? null,
      games_won: row.games_won ?? null,
      games_lost: row.games_lost ?? null,
      rounds: row.rounds ?? null,
      rounds_won: row.rounds_won ?? null,
      rounds_lost: row.rounds_lost ?? null,
      acs: row.acs ?? null,
      kd: row.kd ?? null,
      kast_pct: row.kast_pct ?? null,
      adr: row.adr ?? null,
      kills: row.kills ?? null,
      kpg: row.kpg ?? null,
      kpr: row.kpr ?? null,
      deaths: row.deaths ?? null,
      dpg: row.dpg ?? null,
      dpr: row.dpr ?? null,
      assists: row.assists ?? null,
      apg: row.apg ?? null,
      apr: row.apr ?? null,
      fk: row.fk ?? null,
      fkpg: row.fkpg ?? null,
      fd: row.fd ?? null,
      fdpg: row.fdpg ?? null,
      hs_pct: row.hs_pct ?? null,
      plants: row.plants ?? null,
      plants_per_game: row.plants_per_game ?? null,
      defuses: row.defuses ?? null,
      defuses_per_game: row.defuses_per_game ?? null,
      econ_rating: row.econ_rating ?? null,
      import_batch_id: batchId,
      imported_by_profile_id: admin.id,
    }
  })

  const { error: insertError } = await supabaseAdmin.from('clash_group_stats').insert(insertRows)

  if (insertError) {
    console.error('Error inserting stats:', insertError)
    throw error(500, 'Failed to import stats: ' + insertError.message)
  }

  return json({
    success: true,
    imported: insertRows.length,
    matched,
    unmatched,
    batch_id: batchId,
  })
}
