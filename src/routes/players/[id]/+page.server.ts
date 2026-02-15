import { error } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function getTeamLogoUrl(team: any): string | null {
  if (!team?.logo_path) return null
  return supabaseAdmin.storage.from('team-logos').getPublicUrl(team.logo_path).data.publicUrl
}

export const load = async ({ params, url }: { params: { id: string }; url: URL }) => {
  const profileId = params.id
  if (!UUID_RE.test(profileId)) throw error(404, 'Player not found')

  const selectedBatchId = url.searchParams.get('batchId')

  const { data: reg, error: regError } = await supabaseAdmin
    .from('player_registration')
    .select(
      `
      profile_id,
      riot_id,
      rank_label,
      rank_value,
      pronouns,
      tracker_links,
      created_at,
      profiles!player_registration_profile_id_fkey (
        id,
        display_name,
        email
      )
    `
    )
    .eq('profile_id', profileId)
    .maybeSingle()

  if (regError || !reg) throw error(404, 'Player not found')

  const profileRel = Array.isArray((reg as any).profiles)
    ? (reg as any).profiles[0]
    : (reg as any).profiles

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
        .select('id, display_name, source_filename, import_kind, week_label, created_at, metadata')
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
    })
  }

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
    const latestAggregate = normalizedStats.find((r: any) => r.batch?.import_kind === 'aggregate')
    const latestWeekly = normalizedStats.find((r: any) => r.batch?.import_kind === 'weekly')
    selected = latestAggregate ?? latestWeekly ?? normalizedStats[0] ?? null
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
      profile_id: reg.profile_id,
      riot_id: reg.riot_id,
      rank_label: reg.rank_label ?? null,
      rank_value: (reg as any).rank_value ?? null,
      pronouns: reg.pronouns ?? null,
      tracker_links: reg.tracker_links ?? null,
      display_name: profileRel?.display_name ?? null,
      email: profileRel?.email ?? null,
      created_at: reg.created_at,
    },
    activeTeam,
    stats: {
      rows: normalizedStats,
      selected,
      selectedBatchId: selected?.import_batch_id ?? null,
    },
    matchHistory,
  }
}
