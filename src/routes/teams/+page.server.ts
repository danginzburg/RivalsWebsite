import { supabaseAdmin } from '$lib/supabase/admin'
import { redirect } from '@sveltejs/kit'

export const load = async ({ locals }: { locals: App.Locals }) => {
  if (!locals.user) {
    return {
      requiresLogin: true,
      team: null,
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
      team: null,
    }
  }

  const { data: memberships, error: membershipsError } = await supabaseAdmin
    .from('team_memberships')
    .select('team_id, role, joined_at')
    .eq('profile_id', profile.id)
    .eq('is_active', true)
    .is('left_at', null)

  if (membershipsError) {
    console.error('Failed to load memberships:', membershipsError)
    return {
      requiresLogin: false,
      team: null,
    }
  }

  const membershipRows = memberships ?? []

  if (membershipRows.length === 0) {
    return {
      requiresLogin: false,
      team: null,
    }
  }

  const sortedMemberships = [...membershipRows].sort((a, b) => {
    const score = (role: string) => {
      if (role === 'captain') return 3
      if (role === 'manager') return 2
      return 1
    }

    const roleDelta = score(b.role) - score(a.role)
    if (roleDelta !== 0) return roleDelta
    return new Date(b.joined_at ?? 0).getTime() - new Date(a.joined_at ?? 0).getTime()
  })

  const selectedMembership = sortedMemberships[0]

  const { data: team, error } = await supabaseAdmin
    .from('teams')
    .select('id, name, tag, logo_path, created_at')
    .eq('id', selectedMembership.team_id)
    .maybeSingle()

  if (error) {
    console.error('Failed to load team:', error)
  }

  const withLogo = team
    ? {
        ...team,
        role: selectedMembership.role,
        logo_url: team.logo_path
          ? supabaseAdmin.storage.from('team-logos').getPublicUrl(team.logo_path).data.publicUrl
          : null,
      }
    : null

  if (withLogo) {
    throw redirect(303, `/teams/${withLogo.id}`)
  }

  return {
    requiresLogin: false,
    team: null,
  }
}
