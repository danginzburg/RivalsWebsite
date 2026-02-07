import { supabaseAdmin } from '$lib/supabase/admin'

export const load = async ({ locals }: { locals: App.Locals }) => {
  if (!locals.user) {
    return {
      requiresLogin: true,
      teams: [],
    }
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('auth0_sub', locals.user.sub)
    .maybeSingle()

  if (!profile) {
    return {
      requiresLogin: true,
      teams: [],
    }
  }

  const { data: memberships, error: membershipsError } = await supabaseAdmin
    .from('team_memberships')
    .select('team_id, role')
    .eq('profile_id', profile.id)
    .eq('is_active', true)
    .is('left_at', null)

  if (membershipsError) {
    console.error('Failed to load memberships:', membershipsError)
    return {
      requiresLogin: false,
      teams: [],
    }
  }

  const teamIds = (memberships ?? []).map((membership) => membership.team_id)

  if (teamIds.length === 0) {
    return {
      requiresLogin: false,
      teams: [],
    }
  }

  const roleByTeamId = new Map(
    (memberships ?? []).map((membership) => [membership.team_id, membership.role])
  )

  const { data: teams, error } = await supabaseAdmin
    .from('teams')
    .select('id, name, tag, logo_path, created_at')
    .in('id', teamIds)
    .eq('approval_status', 'approved')
    .order('name', { ascending: true })

  if (error) {
    console.error('Failed to load teams:', error)
  }

  const withLogo = (teams ?? []).map((team) => ({
    ...team,
    role: roleByTeamId.get(team.id) ?? 'player',
    logo_url: team.logo_path
      ? supabaseAdmin.storage.from('team-logos').getPublicUrl(team.logo_path).data.publicUrl
      : null,
  }))

  return {
    requiresLogin: false,
    teams: withLogo,
  }
}
