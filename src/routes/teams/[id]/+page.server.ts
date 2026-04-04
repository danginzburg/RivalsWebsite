import { error } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function getTeamLogoUrl(team: any): string | null {
  if (!team?.logo_path) return null
  return supabaseAdmin.storage.from('team-logos').getPublicUrl(team.logo_path).data.publicUrl
}

export const load = async ({ params, locals }: { params: { id: string }; locals: any }) => {
  const teamId = params.id
  if (!UUID_RE.test(teamId)) throw error(404, 'Team not found')

  const viewerRole = locals.user?.role ?? null
  const isAdmin = viewerRole === 'admin'

  const { data: team, error: teamError } = await supabaseAdmin
    .from('teams')
    .select('id, name, tag, logo_path, approval_status, status, metadata, created_at')
    .eq('id', teamId)
    .maybeSingle()

  if (teamError || !team) throw error(404, 'Team not found')
  if (!isAdmin && team.approval_status !== 'approved') throw error(404, 'Team not found')

  const { data: membershipRows, error: membershipError } = await supabaseAdmin
    .from('team_memberships')
    .select('profile_id, player_name, role')
    .eq('team_id', teamId)
    .eq('is_active', true)
    .is('left_at', null)

  if (membershipError) throw error(500, 'Failed to load team roster')

  const profileIds = Array.from(
    new Set(
      (membershipRows ?? []).map((m) => m.profile_id).filter((id): id is string => Boolean(id))
    )
  )
  const profileById = new Map<string, any>()
  if (profileIds.length > 0) {
    const { data: profileRows } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, email, riot_id_base')
      .in('id', profileIds)
    for (const p of profileRows ?? []) profileById.set(p.id, p)
  }

  const roster = (membershipRows ?? []).map((m: any) => {
    const p = profileById.get(m.profile_id)
    return {
      profile_id: m.profile_id,
      player_name: m.player_name ?? null,
      riot_id_base: p?.riot_id_base ?? null,
      role: m.role ?? 'player',
      display_name: p?.display_name ?? null,
      email: p?.email ?? null,
    }
  })

  const { data: matchHistory } = await supabaseAdmin
    .from('matches')
    .select(
      `
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
    `
    )
    .eq('status', 'completed')
    .eq('approval_status', 'approved')
    .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
    .order('ended_at', { ascending: false })
    .limit(20)

  const { data: upcomingMatches } = await supabaseAdmin
    .from('matches')
    .select(
      `
      id,
      status,
      approval_status,
      scheduled_at,
      team_a_id,
      team_b_id,
      team_a_score,
      team_b_score,
      team_a:teams!matches_team_a_id_fkey (id, name, tag),
      team_b:teams!matches_team_b_id_fkey (id, name, tag)
    `
    )
    .in('status', ['scheduled', 'live'])
    .eq('approval_status', 'approved')
    .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
    .order('scheduled_at', { ascending: true })
    .limit(10)

  const { data: leaderboardBatch } = await supabaseAdmin
    .from('stat_import_batches')
    .select('id, display_name, created_at, metadata')
    .filter('metadata->>import_type', 'eq', 'leaderboard_entries')
    .eq('status', 'applied')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: leaderboardEntry } = leaderboardBatch
    ? await supabaseAdmin
        .from('leaderboard_entries')
        .select('rank, points, matches_played, wins, losses, map_wins, map_losses, round_diff')
        .eq('import_batch_id', leaderboardBatch.id)
        .eq('team_id', teamId)
        .maybeSingle()
    : { data: null }

  const { data: statsBatches } = await supabaseAdmin
    .from('stat_import_batches')
    .select('id, import_kind, created_at, metadata')
    .filter('metadata->>import_type', 'eq', 'rivals_group_stats')
    .eq('status', 'applied')
    .order('created_at', { ascending: false })
    .limit(50)

  const statsBatchId =
    (statsBatches ?? []).find((batch: any) => batch.import_kind === 'aggregate')?.id ??
    (statsBatches ?? [])[0]?.id ??
    null

  const { data: rosterStats } =
    statsBatchId && profileIds.length > 0
      ? await supabaseAdmin
          .from('rivals_group_stats')
          .select('profile_id, player_name, acs, kd, adr, games, agents')
          .eq('import_batch_id', statsBatchId)
          .in('profile_id', profileIds)
          .order('acs', { ascending: false })
      : { data: [] }

  const statsByProfileId = new Map<string, any>()
  for (const row of rosterStats ?? []) {
    if (row.profile_id) statsByProfileId.set(row.profile_id, row)
  }

  return {
    team: {
      id: team.id,
      name: team.name,
      tag: team.tag ?? null,
      logo_url: getTeamLogoUrl(team),
      status: team.status,
      org: team.metadata?.org ?? null,
      about: team.metadata?.about ?? null,
      created_at: team.created_at,
    },
    roster: roster.map((player) => ({
      ...player,
      stats: statsByProfileId.get(player.profile_id) ?? null,
    })),
    matchHistory: matchHistory ?? [],
    upcomingMatches: upcomingMatches ?? [],
    leaderboard: leaderboardEntry
      ? {
          ...leaderboardEntry,
          batch: {
            display_name: leaderboardBatch?.display_name ?? null,
            as_of_date: leaderboardBatch?.metadata?.as_of_date ?? null,
          },
        }
      : null,
    viewer: { isAdmin },
  }
}
