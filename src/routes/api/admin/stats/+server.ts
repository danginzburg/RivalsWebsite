import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'
import { requireAdmin } from '$lib/server/auth/profile'

export const POST: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)

  const body = await request.json().catch(() => ({}))
  const rows = body?.rows
  const sourceFilename = typeof body?.sourceFilename === 'string' ? body.sourceFilename.trim() : ''
  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : ''
  const importKind = typeof body?.importKind === 'string' ? body.importKind.trim() : ''
  const weekLabel = typeof body?.weekLabel === 'string' ? body.weekLabel.trim() : ''

  if (!Array.isArray(rows) || rows.length === 0) {
    throw error(400, 'No rows provided')
  }

  if (importKind && importKind !== 'weekly' && importKind !== 'aggregate') {
    throw error(400, 'importKind must be weekly or aggregate')
  }

  if ((importKind || 'weekly') === 'weekly' && weekLabel && weekLabel.length > 48) {
    throw error(400, 'weekLabel is too long')
  }

  const MAX_ROWS = 1000
  if (rows.length > MAX_ROWS) {
    throw error(400, `Too many rows provided; maximum is ${MAX_ROWS}`)
  }
  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, riot_id_base')

  if (profilesError) {
    console.error('Error fetching profiles:', profilesError)
    throw error(500, 'Failed to fetch profiles: ' + profilesError.message)
  }

  const normalizeKey = (value: string) => value.trim().toLowerCase()
  const normalizeBase = (value: string) => value.split('#')[0]?.trim().toLowerCase()

  const profileMap = new Map<string, string>()
  for (const p of profiles ?? []) {
    if (p.riot_id_base) {
      const full = normalizeKey(p.riot_id_base)
      const base = normalizeBase(p.riot_id_base)
      profileMap.set(full, p.id)
      if (base && base !== full) profileMap.set(base, p.id)
    }
    if (p.display_name) {
      const full = normalizeKey(p.display_name)
      const base = normalizeBase(p.display_name)
      profileMap.set(full, p.id)
      if (base && base !== full) profileMap.set(base, p.id)
    }
  }

  // Build insert rows with server-side profile matching
  let matched = 0
  let unmatched = 0

  const batchId = crypto.randomUUID()
  const importedAt = new Date().toISOString()

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
      imported_at: importedAt,
    }
  })

  // Track unmatched rows in stat_import_errors (best-effort; table may not exist yet)
  const errorRows = insertRows
    .map((r: any, idx: number) => ({ row: r, idx }))
    .filter((x) => !x.row.profile_id)
    .map((x) => ({
      batch_id: batchId,
      row_number: x.idx + 2,
      field_name: 'player_name',
      error_code: 'unmatched_player',
      error_message: `No user matched for "${x.row.player_name}"`,
      row_payload: x.row,
    }))

  const batchPayload: any = {
    id: batchId,
    uploaded_by_profile_id: admin.id,
    source_filename: sourceFilename || 'add-stats.csv',
    display_name: displayName || sourceFilename || 'Stats Import',
    import_kind: importKind || 'weekly',
    week_label: (importKind || 'weekly') === 'weekly' ? weekLabel || null : null,
    status: 'applied',
    dry_run: false,
    row_count: insertRows.length,
    accepted_count: matched,
    rejected_count: unmatched,
    metadata: {
      import_type: 'rivals_group_stats',
      import_kind: importKind || 'weekly',
      week_label: (importKind || 'weekly') === 'weekly' ? weekLabel || null : null,
    },
  }

  let batchInsertError: any = null
  {
    const { error: err } = await supabaseAdmin.from('stat_import_batches').insert(batchPayload)
    batchInsertError = err
  }

  // Backwards compatibility if display fields aren't migrated yet.
  if (batchInsertError && String(batchInsertError.message || '').includes('display_name')) {
    const fallbackPayload = { ...batchPayload }
    delete fallbackPayload.display_name
    delete fallbackPayload.import_kind
    delete fallbackPayload.week_label
    const { error: err } = await supabaseAdmin.from('stat_import_batches').insert(fallbackPayload)
    batchInsertError = err
  }

  // If stat_import_batches isn't deployed yet, don't block import.
  if (batchInsertError) {
    console.warn('Failed to write stat_import_batches row:', batchInsertError)
  }

  if (errorRows.length > 0) {
    const { error: errInsertError } = await supabaseAdmin
      .from('stat_import_errors')
      .insert(errorRows)
    if (errInsertError) {
      console.warn('Failed to write stat_import_errors rows:', errInsertError)
    }
  }

  const { error: insertError } = await supabaseAdmin.from('rivals_group_stats').insert(insertRows)

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
