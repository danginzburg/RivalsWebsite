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
    .select('id, name, tag, logo_path, approval_status, status')
    .eq('id', teamId)
    .maybeSingle()

  if (teamError || !team) throw error(404, 'Team not found')
  if (!isAdmin && team.approval_status !== 'approved') throw error(404, 'Team not found')

  const { data: membershipRows, error: membershipError } = await supabaseAdmin
    .from('team_memberships')
    .select('profile_id, role')
    .eq('team_id', teamId)
    .eq('is_active', true)
    .is('left_at', null)

  if (membershipError) throw error(500, 'Failed to load team roster')

  const profileIds = Array.from(new Set((membershipRows ?? []).map((m) => m.profile_id)))
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
      riot_id_base: p?.riot_id_base ?? null,
      role: m.role ?? 'player',
      display_name: p?.display_name ?? null,
      email: p?.email ?? null,
    }
  })

  const { data: matches } = await supabaseAdmin
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
    .limit(50)

  return {
    team: {
      id: team.id,
      name: team.name,
      tag: team.tag ?? null,
      logo_url: getTeamLogoUrl(team),
    },
    roster,
    matchHistory: matches ?? [],
    viewer: { isAdmin },
  }
}
