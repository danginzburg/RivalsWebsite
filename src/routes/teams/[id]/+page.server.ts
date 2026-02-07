import { error } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'

export const load = async ({ params, locals }: { params: { id: string }; locals: App.Locals }) => {
  const teamId = params.id

  let isAdmin = false
  if (locals.user) {
    const { data: viewerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('auth0_sub', locals.user.sub)
      .maybeSingle()

    isAdmin = viewerProfile?.role === 'admin'
  }

  const { data: team, error: teamError } = await supabaseAdmin
    .from('teams')
    .select(
      `
      id,
      name,
      tag,
      logo_path,
      metadata,
      approval_status,
      created_at,
      profiles!teams_submitted_by_profile_id_fkey (
        id,
        display_name,
        email
      )
    `
    )
    .eq('id', teamId)
    .maybeSingle()

  if (teamError || !team) {
    throw error(404, 'Team not found')
  }

  if (team.approval_status !== 'approved' && !isAdmin) {
    throw error(404, 'Team not found')
  }

  const { data: memberships } = await supabaseAdmin
    .from('team_memberships')
    .select('profile_id, role, is_active, left_at')
    .eq('team_id', teamId)
    .eq('is_active', true)
    .is('left_at', null)

  const rosterProfileIds = (memberships ?? []).map((m) => m.profile_id)

  let roster: Array<{
    profile_id: string
    role: string
    riot_id: string
    rank_label: string | null
    display_name: string | null
    email: string | null
  }> = []

  if (rosterProfileIds.length > 0) {
    const { data: rosterRows } = await supabaseAdmin
      .from('player_registration')
      .select(
        `
        profile_id,
        riot_id,
        rank_label,
        profiles!player_registration_profile_id_fkey (
          display_name,
          email
        )
      `
      )
      .in('profile_id', rosterProfileIds)

    const roleMap = new Map((memberships ?? []).map((m) => [m.profile_id, m.role]))

    roster = (rosterRows ?? []).map((row: any) => {
      const profileRel = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
      return {
        profile_id: row.profile_id,
        role: roleMap.get(row.profile_id) ?? 'player',
        riot_id: row.riot_id,
        rank_label: row.rank_label ?? null,
        display_name: profileRel?.display_name ?? null,
        email: profileRel?.email ?? null,
      }
    })
  }

  roster.sort((a, b) => {
    if (a.role === 'captain' && b.role !== 'captain') return -1
    if (b.role === 'captain' && a.role !== 'captain') return 1
    return a.riot_id.localeCompare(b.riot_id)
  })

  const logoUrl = team.logo_path
    ? supabaseAdmin.storage.from('team-logos').getPublicUrl(team.logo_path).data.publicUrl
    : null

  return {
    team: {
      ...team,
      logo_url: logoUrl,
    },
    roster,
  }
}
