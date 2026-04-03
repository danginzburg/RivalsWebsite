import { error, redirect } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import type { Actions } from './$types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function extractNumericLabel(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const m = value.match(/(\d+)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

function isLatestLabel(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return value.trim().toLowerCase().includes('latest')
}

function toBatchLabel(b: any): string {
  const base = (b?.display_name ?? b?.id ?? '').toString()
  if (b?.import_kind === 'weekly' && b?.week_label) return `${base} (${b.week_label})`
  return base
}

function kindOrder(kind: unknown): number {
  return kind === 'aggregate' ? 0 : kind === 'weekly' ? 1 : 2
}

function getTeamLogoUrl(team: any): string | null {
  if (!team?.logo_path) return null
  return supabaseAdmin.storage.from('team-logos').getPublicUrl(team.logo_path).data.publicUrl
}

export const load = async ({
  params,
  url,
  locals,
}: {
  params: { id: string }
  url: URL
  locals: App.Locals
}) => {
  const profileId = params.id
  if (!UUID_RE.test(profileId)) throw error(404, 'Player not found')

  const selectedBatchId = url.searchParams.get('batchId')

  const { data: profileRel, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, auth0_sub, role, display_name, email, riot_id_base, created_at')
    .eq('id', profileId)
    .maybeSingle()

  if (profileError) {
    const msg = String((profileError as any).message ?? '')
    if (msg.toLowerCase().includes('riot_id_base')) {
      throw error(500, 'Database missing profiles.riot_id_base; apply the Supabase migration')
    }
    throw error(500, msg || 'Failed to load player')
  }

  if (!profileRel) throw error(404, 'Player not found')

  // Viewer permissions for inline Riot ID setup.
  let canEditRiotIdBase = false
  if (locals.user) {
    if ((profileRel as any).auth0_sub && (profileRel as any).auth0_sub === locals.user.sub) {
      canEditRiotIdBase = true
    } else {
      const { data: viewer } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('auth0_sub', locals.user.sub)
        .maybeSingle()
      canEditRiotIdBase = viewer?.role === 'admin'
    }
  }

  const { data: membership } = await supabaseAdmin
    .from('team_memberships')
    .select(
      `
      team_id,
      role,
      teams (id, name, tag, logo_path, approval_status)
    `
    )
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .is('left_at', null)
    .maybeSingle()

  const teamRel = membership
    ? Array.isArray((membership as any).teams)
      ? (membership as any).teams[0]
      : (membership as any).teams
    : null

  const activeTeam =
    teamRel?.approval_status === 'approved'
      ? {
          id: teamRel.id,
          name: teamRel.name,
          tag: teamRel.tag ?? null,
          logo_url: getTeamLogoUrl(teamRel),
          role: membership?.role ?? null,
        }
      : null

  const { data: statsRows } = await supabaseAdmin
    .from('rivals_group_stats')
    .select(
      'id, player_name, profile_id, agents, games, games_won, games_lost, rounds, rounds_won, rounds_lost, acs, kd, kast_pct, adr, kills, deaths, assists, fk, fd, hs_pct, econ_rating, kpg, kpr, dpg, dpr, apg, apr, fkpg, fdpg, plants, plants_per_game, defuses, defuses_per_game, import_batch_id, imported_at'
    )
    .eq('profile_id', profileId)
    .order('imported_at', { ascending: false })
    .limit(200)

  const batchIds = Array.from(
    new Set((statsRows ?? []).map((r: any) => r.import_batch_id).filter(Boolean))
  )

  const { data: batches } = batchIds.length
    ? await supabaseAdmin
        .from('stat_import_batches')
        .select(
          'id, display_name, source_filename, import_kind, week_label, created_at, metadata, sort_order'
        )
        .in('id', batchIds)
        .order('created_at', { ascending: false })
    : { data: [] }

  const batchById = new Map<string, any>()
  for (const b of batches ?? []) {
    batchById.set(b.id, {
      id: b.id,
      display_name: b.display_name ?? b.source_filename,
      import_kind: b.import_kind ?? b.metadata?.import_kind ?? null,
      week_label: b.week_label ?? b.metadata?.week_label ?? null,
      created_at: b.created_at,
      sort_order: (b as any).sort_order ?? null,
    })
  }

  const batchOptions = Array.from(batchById.values())
    .sort((a, b) => {
      const ka = kindOrder(a.import_kind)
      const kb = kindOrder(b.import_kind)
      if (ka !== kb) return ka - kb

      const ao = a.sort_order
      const bo = b.sort_order
      if (typeof ao === 'number' && typeof bo === 'number' && ao !== bo) return ao - bo
      if (typeof ao === 'number' && typeof bo !== 'number') return -1
      if (typeof ao !== 'number' && typeof bo === 'number') return 1

      const ta = a.created_at ? new Date(a.created_at).getTime() : 0
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0
      if (ta !== tb) return tb - ta

      return toBatchLabel(a).localeCompare(toBatchLabel(b))
    })
    .map((b) => ({ label: toBatchLabel(b), value: b.id }))

  const normalizedStats = (statsRows ?? []).map((r: any) => ({
    ...r,
    batch: batchById.get(r.import_batch_id) ?? {
      id: r.import_batch_id,
      display_name: r.import_batch_id,
    },
  }))

  let selected = null as any
  if (selectedBatchId) {
    selected = normalizedStats.find((r: any) => r.import_batch_id === selectedBatchId) ?? null
  }

  if (!selected) {
    const byBatchId = new Map<string, any>()
    for (const r of normalizedStats) {
      if (!r.import_batch_id) continue
      if (byBatchId.has(r.import_batch_id)) continue
      byBatchId.set(r.import_batch_id, r)
    }

    const aggregates = Array.from(byBatchId.values()).filter(
      (r: any) => r.batch?.import_kind === 'aggregate'
    )
    const weeklies = Array.from(byBatchId.values()).filter(
      (r: any) => r.batch?.import_kind === 'weekly'
    )

    function sortBatches(a: any, b: any) {
      const ao = a.batch?.sort_order
      const bo = b.batch?.sort_order
      if (typeof ao === 'number' && typeof bo === 'number' && ao !== bo) return ao - bo
      if (typeof ao === 'number' && typeof bo !== 'number') return -1
      if (typeof ao !== 'number' && typeof bo === 'number') return 1

      const aName = a.batch?.display_name ?? ''
      const bName = b.batch?.display_name ?? ''

      const aLatest = isLatestLabel(aName)
      const bLatest = isLatestLabel(bName)
      if (aLatest !== bLatest) return aLatest ? -1 : 1

      const na = extractNumericLabel(aName)
      const nb = extractNumericLabel(bName)
      if (na !== null && nb !== null && na !== nb) return nb - na

      // When either side lacks a numeric label, fall back to time ordering instead of
      // always preferring the numeric-labeled batch.
      const ta = a.batch?.created_at ? new Date(a.batch.created_at).getTime() : 0
      const tb = b.batch?.created_at ? new Date(b.batch.created_at).getTime() : 0
      if (ta !== tb) return tb - ta

      const ia = a.imported_at ? new Date(a.imported_at).getTime() : 0
      const ib = b.imported_at ? new Date(b.imported_at).getTime() : 0
      if (ia !== ib) return ib - ia

      return String(aName).localeCompare(String(bName))
    }

    aggregates.sort(sortBatches)
    weeklies.sort(sortBatches)

    selected = aggregates[0] ?? weeklies[0] ?? normalizedStats[0] ?? null
  }

  const { data: participated } = await supabaseAdmin
    .from('player_match_stats')
    .select(
      `
      match_id,
      team_id,
      status,
      matches (
        id,
        status,
        approval_status,
        scheduled_at,
        ended_at,
        team_a_id,
        team_b_id,
        team_a_score,
        team_b_score,
        winner_team_id,
        team_a:teams!matches_team_a_id_fkey (id, name, tag),
        team_b:teams!matches_team_b_id_fkey (id, name, tag)
      )
    `
    )
    .eq('profile_id', profileId)
    .in('status', ['submitted', 'approved'])
    .order('created_at', { ascending: false })
    .limit(50)

  const matchHistory = (participated ?? [])
    .map((r: any) => {
      const matchRel = Array.isArray(r.matches) ? r.matches[0] : r.matches
      return {
        match: matchRel ?? null,
        team_id: r.team_id,
        status: r.status,
      }
    })
    .filter((x: any) => x.match && x.match.approval_status === 'approved')

  return {
    player: {
      profile_id: profileId,
      riot_id: profileRel.riot_id_base ?? profileRel.display_name ?? profileRel.email ?? 'Player',
      riot_id_base: profileRel.riot_id_base ?? null,
      rank_label: null,
      rank_value: null,
      pronouns: null,
      tracker_links: null,
      display_name: profileRel?.display_name ?? null,
      email: profileRel?.email ?? null,
      created_at: profileRel?.created_at ?? null,
    },
    activeTeam,
    viewer: {
      canEditRiotIdBase,
    },
    stats: {
      rows: normalizedStats,
      selected,
      selectedBatchId: selected?.import_batch_id ?? null,
      batchOptions,
    },
    matchHistory,
  }
}

function normalizeRiotBase(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  return raw.split('#')[0].trim()
}

function isValidRiotBase(value: string) {
  if (!value) return false
  if (value.includes('#')) return false
  if (value.length < 3 || value.length > 24) return false
  return true
}

export const actions: Actions = {
  setRiotIdBase: async ({ locals, params, request }) => {
    if (!locals.user) throw redirect(303, `/auth/login?returnTo=/players/${params.id}`)

    const form = await request.formData()
    const riotIdBase = normalizeRiotBase(form.get('riot_id_base'))
    if (!isValidRiotBase(riotIdBase)) {
      return { success: false, message: 'Enter a valid Riot ID base name (no #tag).' }
    }

    const { data: viewer, error: viewerError } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('auth0_sub', locals.user.sub)
      .maybeSingle()

    if (viewerError || !viewer) throw error(403, 'Profile not found')

    const { data: target, error: targetError } = await supabaseAdmin
      .from('profiles')
      .select('id, auth0_sub')
      .eq('id', params.id)
      .maybeSingle()

    if (targetError || !target) throw error(404, 'Player not found')

    const isSelf = target.auth0_sub && target.auth0_sub === locals.user.sub
    const isAdmin = viewer.role === 'admin'
    if (!isSelf && !isAdmin) throw error(403, 'Not allowed')

    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .ilike('riot_id_base', riotIdBase)
      .neq('id', target.id)
      .maybeSingle()

    if (existing?.id) {
      return { success: false, message: 'That Riot ID is already claimed by another account.' }
    }

    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ riot_id_base: riotIdBase })
      .eq('id', target.id)

    if (updateError) return { success: false, message: updateError.message }

    // Best-effort auto-relink of imported stats after claiming Riot ID.
    // This avoids needing a manual admin rematch step.
    const { error: rpcError } = await supabaseAdmin.rpc('rematch_rivals_group_stats', {
      batch_id: null,
    })
    if (rpcError) {
      console.warn('rematch_rivals_group_stats failed:', rpcError)
    }

    throw redirect(303, `/players/${target.id}`)
  },
}
