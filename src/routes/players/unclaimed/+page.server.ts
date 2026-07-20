import { error, redirect, type Actions } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'
import { rematchPlayerMatchMapStatsForBase } from '$lib/server/imports/matching'
import { average, sum, weightedAverage } from '$lib/server/math'
import { normalizeRiotBase, isValidRiotBase } from '$lib/server/riot-id'
import { toBatchLabel } from '$lib/server/stats/batch-label'
import {
  normalizeRivalsGroupStatBatchFromDb,
  type NormalizedRivalsGroupStatBatch,
  type StatImportBatchRow,
} from '$lib/server/stats/rivals-batch'
import { claimRelinkAfterProfileUpdate } from '$lib/server/players/claim-relink'
import { rankValue } from '$lib/ranks/ranks'

type StatBatchInfo = Partial<NormalizedRivalsGroupStatBatch> & { id: string; display_name: string }

type CandidateRow = {
  import_batch_id: string
  player_name?: string | null
  games?: number | null
  imported_at?: string | null
  [key: string]: unknown
}

type TeamLite = { id: string; name: string; tag?: string | null }

type MatchRel = {
  id: string
  status?: string | null
  approval_status?: string | null
  scheduled_at?: string | null
  ended_at?: string | null
  team_a_id?: string | null
  team_b_id?: string | null
  team_a_score?: number | null
  team_b_score?: number | null
  team_a?: TeamLite | TeamLite[] | null
  team_b?: TeamLite | TeamLite[] | null
}

type MatchMapRow = {
  match_id?: string | null
  team_id?: string | null
  agents?: string | null
  acs?: number | null
  kills?: number | null
  deaths?: number | null
  assists?: number | null
  kast_pct?: number | null
  hs_pct?: number | null
  matches?: MatchRel | MatchRel[] | null
}

function normalizeNameBase(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  return raw.split('#')[0].trim()
}

function quoteOrValue(value: string): string {
  // PostgREST filter syntax supports quoted values.
  // Double quotes inside are escaped by doubling.
  return `"${value.replaceAll('"', '""')}"`
}

function kindOrder(kind: unknown): number {
  return kind === 'aggregate' ? 0 : kind === 'weekly' ? 1 : 2
}

export const load: PageServerLoad = async ({ url, locals }) => {
  const clickedName = String(url.searchParams.get('name') ?? '').trim()
  if (!clickedName) throw error(400, 'Missing name')

  const base = normalizeNameBase(clickedName)
  if (!base) throw error(400, 'Invalid name')

  const requestedBatchId = String(url.searchParams.get('batchId') ?? '').trim() || null

  let viewer: { profileId: string; displayName: string | null; riotIdBase: string | null } | null =
    null
  if (locals.user) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, riot_id_base')
      .eq('auth0_sub', locals.user.sub)
      .maybeSingle()

    if (profile?.id) {
      viewer = {
        profileId: profile.id,
        displayName: profile.display_name ?? null,
        riotIdBase: profile.riot_id_base ?? null,
      }
    }
  }

  // Find all batches where this base appears (base or base#tag variants).
  const baseQuoted = quoteOrValue(base)
  const baseTagLikeQuoted = quoteOrValue(`${base}#%`)
  const { data: appearances, error: appearancesError } = await supabaseAdmin
    .from('rivals_group_stats')
    .select('import_batch_id, player_name, games, imported_at, profile_id, league_rank')
    .or(`player_name.eq.${baseQuoted},player_name.ilike.${baseTagLikeQuoted}`)
    .limit(2000)

  if (appearancesError) {
    console.error('Failed to load unclaimed appearances:', appearancesError)
    throw error(500, 'Failed to load stats')
  }

  const batchIds = Array.from(
    new Set(
      ((appearances ?? []) as Array<{ import_batch_id: string | null }>)
        .map((r) => String(r.import_batch_id))
        .filter(Boolean)
    )
  )

  const batchById = new Map<string, NormalizedRivalsGroupStatBatch>()
  if (batchIds.length > 0) {
    const { data: batchRows, error: batchError } = await supabaseAdmin
      .from('stat_import_batches')
      .select(
        'id, display_name, source_filename, import_kind, week_label, created_at, metadata, sort_order'
      )
      .in('id', batchIds)
      .limit(500)

    if (batchError) {
      console.error('Failed to load batch metadata:', batchError)
    }

    for (const b of batchRows ?? []) {
      batchById.set(
        b.id,
        normalizeRivalsGroupStatBatchFromDb(b as StatImportBatchRow, {
          displayNameFallback: 'source_filename',
        })
      )
    }
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
    .map((b) => ({
      label: toBatchLabel(b),
      value: b.id,
      import_kind: b.import_kind ?? null,
      week_label: b.week_label ?? null,
    }))

  const batchId =
    (requestedBatchId && batchById.has(requestedBatchId) ? requestedBatchId : null) ??
    batchOptions[0]?.value ??
    null

  let selected: (CandidateRow & { batch?: StatBatchInfo }) | null = null
  if (batchId) {
    const clickedQuoted = quoteOrValue(clickedName)
    const baseLikeQuoted = quoteOrValue(`${base}#%`)

    const { data: candidates, error: rowError } = await supabaseAdmin
      .from('rivals_group_stats')
      .select(
        'id, player_name, profile_id, agents, games, games_won, games_lost, rounds, rounds_won, rounds_lost, acs, kd, kast_pct, adr, kills, deaths, assists, fk, fd, hs_pct, econ_rating, kpg, kpr, dpg, dpr, apg, apr, fkpg, fdpg, plants, plants_per_game, defuses, defuses_per_game, league_rank, import_batch_id, imported_at'
      )
      .eq('import_batch_id', batchId)
      .or(
        `player_name.eq.${clickedQuoted},player_name.eq.${baseQuoted},player_name.ilike.${baseLikeQuoted}`
      )
      .limit(25)

    if (rowError) {
      console.error('Failed to load unclaimed row:', rowError)
    } else {
      const list = (candidates ?? []) as CandidateRow[]
      selected =
        list.find((r) => String(r.player_name ?? '').trim() === clickedName) ??
        list.sort((a, b) => {
          const ga = Number(a?.games ?? 0)
          const gb = Number(b?.games ?? 0)
          if (ga !== gb) return gb - ga
          const ta = a?.imported_at ? new Date(a.imported_at).getTime() : 0
          const tb = b?.imported_at ? new Date(b.imported_at).getTime() : 0
          return tb - ta
        })[0] ??
        null

      if (selected) {
        selected = {
          ...selected,
          batch: batchById.get(selected.import_batch_id) ?? {
            id: selected.import_batch_id,
            display_name: selected.import_batch_id,
            import_kind: null,
            week_label: null,
          },
        }
      }
    }
  }

  const [{ data: matchRows }, { data: perMapRows }] = await Promise.all([
    supabaseAdmin
      .from('player_match_map_stats')
      .select(
        `
      match_id,
      team_id,
      profile_id,
      player_name,
      agents,
      acs,
      kills,
      deaths,
      assists,
      kast_pct,
      hs_pct,
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
        team_a:teams!matches_team_a_id_fkey (id, name, tag),
        team_b:teams!matches_team_b_id_fkey (id, name, tag)
      )
    `
      )
      .is('profile_id', null)
      .or(`player_name.eq.${baseQuoted},player_name.ilike.${baseTagLikeQuoted}`)
      .limit(500),
    supabaseAdmin
      .from('player_match_map_stats')
      .select(
        'team_id, agents, acs, kills, deaths, assists, kd, adr, kast_pct, hs_pct, rounds, fk, fd, plants, defuses, match_maps(map_name, is_voided, team_a_rounds, team_b_rounds, matches(team_a_id, team_b_id))'
      )
      .is('profile_id', null)
      .or(`player_name.eq.${baseQuoted},player_name.ilike.${baseTagLikeQuoted}`)
      .limit(1000),
  ])

  const byMatch = new Map<string, MatchMapRow[]>()
  for (const row of (matchRows ?? []) as MatchMapRow[]) {
    const matchId = String(row.match_id ?? '')
    if (!matchId) continue
    const current = byMatch.get(matchId) ?? []
    current.push(row)
    byMatch.set(matchId, current)
  }

  const matchHistory = Array.from(byMatch.values())
    .map((rows) => {
      const first = rows[0]
      const matchRel = Array.isArray(first.matches) ? first.matches[0] : first.matches
      const perspectiveTeamId = first.team_id
      const rawOpponent =
        matchRel?.team_a_id === perspectiveTeamId
          ? matchRel?.team_b
          : matchRel?.team_b_id === perspectiveTeamId
            ? matchRel?.team_a
            : null
      const opponent = Array.isArray(rawOpponent) ? (rawOpponent[0] ?? null) : (rawOpponent ?? null)
      const score =
        matchRel?.team_a_id === perspectiveTeamId
          ? { us: Number(matchRel?.team_a_score ?? 0), them: Number(matchRel?.team_b_score ?? 0) }
          : { us: Number(matchRel?.team_b_score ?? 0), them: Number(matchRel?.team_a_score ?? 0) }

      return {
        match: matchRel ?? null,
        opponent,
        score,
        agents: Array.from(
          new Set(
            rows
              .flatMap((row) => String(row.agents ?? '').split(/\s+/))
              .map((value) => value.trim())
              .filter(Boolean)
          )
        ).join(' '),
        acs: average(rows.map((row) => row.acs)),
        kills: sum(rows.map((row) => row.kills)),
        deaths: sum(rows.map((row) => row.deaths)),
        assists: sum(rows.map((row) => row.assists)),
        kast_pct: average(rows.map((row) => row.kast_pct)),
        hs_pct: average(rows.map((row) => row.hs_pct)),
      }
    })
    .filter(
      (entry): entry is typeof entry & { match: MatchRel } =>
        Boolean(entry.match) && entry.match?.approval_status === 'approved'
    )

  type PerMapStatRow = {
    team_id: string | null
    agents: string | null
    acs: number | null
    kills: number | null
    deaths: number | null
    assists: number | null
    kd: number | null
    adr: number | null
    kast_pct: number | null
    hs_pct: number | null
    rounds: number | null
    fk: number | null
    fd: number | null
    plants: number | null
    defuses: number | null
    match_maps: {
      map_name: string | null
      is_voided: boolean
      team_a_rounds: number | null
      team_b_rounds: number | null
      matches: { team_a_id: string | null; team_b_id: string | null } | null
    } | null
  }

  function didWinMap(row: PerMapStatRow): boolean | null {
    const mm = Array.isArray(row.match_maps) ? row.match_maps[0] : row.match_maps
    if (!mm || !row.team_id) return null
    const match = Array.isArray(mm.matches) ? mm.matches[0] : mm.matches
    if (!match) return null
    const aRounds = mm.team_a_rounds ?? 0
    const bRounds = mm.team_b_rounds ?? 0
    if (aRounds === bRounds) return null
    const isTeamA = row.team_id === match.team_a_id
    return isTeamA ? aRounds > bRounds : bRounds > aRounds
  }

  const validPerMap = ((perMapRows ?? []) as unknown as PerMapStatRow[]).filter((r) => {
    const mm = Array.isArray(r.match_maps) ? r.match_maps[0] : r.match_maps
    return mm && !mm.is_voided && mm.map_name
  })

  function aggregatePerMap(rows: PerMapStatRow[]) {
    const totalKills = sum(rows.map((r) => r.kills))
    const totalDeaths = sum(rows.map((r) => r.deaths))
    const wins = rows.filter((r) => didWinMap(r) === true)
    const decided = rows.filter((r) => didWinMap(r) !== null)
    return {
      maps_played: rows.length,
      maps_won: wins.length,
      win_pct: decided.length > 0 ? (wins.length / decided.length) * 100 : null,
      rounds: sum(rows.map((r) => r.rounds)),
      acs: average(rows.map((r) => r.acs)),
      kills: totalKills,
      deaths: totalDeaths,
      assists: sum(rows.map((r) => r.assists)),
      kd: totalDeaths > 0 ? totalKills / totalDeaths : null,
      adr: weightedAverage(
        rows.map((r) => ({ adr: r.adr, rounds: r.rounds })),
        'adr',
        'rounds'
      ),
      kast_pct: weightedAverage(
        rows.map((r) => ({ kast_pct: r.kast_pct, rounds: r.rounds })),
        'kast_pct',
        'rounds'
      ),
      hs_pct: average(rows.map((r) => r.hs_pct)),
      fk: sum(rows.map((r) => r.fk)),
      fd: sum(rows.map((r) => r.fd)),
    }
  }

  const byMap = new Map<string, PerMapStatRow[]>()
  for (const r of validPerMap) {
    const mm = Array.isArray(r.match_maps) ? r.match_maps[0] : r.match_maps
    const mapName = mm?.map_name ?? 'Unknown'
    const arr = byMap.get(mapName) ?? []
    arr.push(r)
    byMap.set(mapName, arr)
  }
  const mapStats = Array.from(byMap.entries())
    .map(([mapName, rows]) => ({ key: mapName, ...aggregatePerMap(rows) }))
    .sort((a, b) => b.maps_played - a.maps_played)

  const byAgent = new Map<string, PerMapStatRow[]>()
  for (const r of validPerMap) {
    const agents = String(r.agents ?? '')
      .split(/\s+/)
      .map((a) => a.trim())
      .filter(Boolean)
    for (const agent of agents.length > 0 ? agents : ['Unknown']) {
      const arr = byAgent.get(agent) ?? []
      arr.push(r)
      byAgent.set(agent, arr)
    }
  }
  const agentStats = Array.from(byAgent.entries())
    .map(([agent, rows]) => ({ key: agent, ...aggregatePerMap(rows) }))
    .sort((a, b) => b.maps_played - a.maps_played)

  let bestRank: string | null = null
  let bestRankValue = 0
  for (const r of (appearances ?? []) as Array<{ league_rank?: string | null }>) {
    const raw = r.league_rank ?? null
    if (!raw) continue
    const v = rankValue(raw)
    if (v > bestRankValue) {
      bestRankValue = v
      bestRank = raw
    }
  }

  return {
    clickedName,
    base,
    batchId,
    batchOptions,
    selected,
    bestRank,
    viewer,
    matchHistory,
    mapStats,
    agentStats,
  }
}

export const actions: Actions = {
  claim: async ({ locals, request, url }) => {
    if (!locals.user)
      throw redirect(303, `/auth/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`)

    const form = await request.formData()
    const riotIdBase = normalizeRiotBase(form.get('riot_id_base'))
    if (!isValidRiotBase(riotIdBase)) {
      return { success: false, message: 'Enter a valid Riot ID base name (no #tag).' }
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('auth0_sub', locals.user.sub)
      .maybeSingle()

    if (!profile?.id) throw error(404, 'Profile not found')

    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .ilike('riot_id_base', riotIdBase)
      .neq('id', profile.id)
      .maybeSingle()

    if (existing?.id) {
      return { success: false, message: 'That Riot ID is already claimed by another account.' }
    }

    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ riot_id_base: riotIdBase })
      .eq('id', profile.id)

    if (updateError) return { success: false, message: updateError.message }

    try {
      await claimRelinkAfterProfileUpdate(profile.id)
    } catch (err) {
      console.warn('claimRelinkAfterProfileUpdate failed:', err)
    }

    try {
      await rematchPlayerMatchMapStatsForBase(profile.id, riotIdBase)
    } catch (err) {
      console.warn('Failed to rematch match map stats after claim:', err)
    }

    throw redirect(303, `/players/${profile.id}`)
  },
}
