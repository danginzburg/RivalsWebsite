import { redirect, error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'

export const load: PageServerLoad = async ({ locals }) => {
  // Check if user is authenticated
  if (!locals.user) {
    redirect(303, '/auth/login?returnTo=/admin')
  }

  // Check if user is an admin
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, role')
    .eq('auth0_sub', locals.user.sub)
    .single()

  if (profileError || !profile) {
    throw error(403, 'Profile not found')
  }

  if (profile.role !== 'admin') {
    throw error(403, 'Access denied. Administrator privileges required.')
  }

  // Fetch player registrations with profile info
  const { data: players, error: playersError } = await supabaseAdmin
    .from('player_registration')
    .select(
      `
      id,
      riot_id,
      rank_label,
      rank_value,
      pronouns,
      tracker_links,
      created_at,
      updated_at,
      profiles!player_registration_profile_id_fkey (
        email,
        display_name
      )
    `
    )
    .order('created_at', { ascending: false })

  if (playersError) {
    console.error('Error fetching players:', playersError)
  }

  // Fetch observer registrations with profile info
  const { data: observers, error: observersError } = await supabaseAdmin
    .from('observer_registration')
    .select(
      `
      id,
      has_previous_experience,
      can_stream_quality,
      willing_to_use_overlay,
      additional_info,
      created_at,
      updated_at,
      profiles (
        email,
        display_name
      )
    `
    )
    .order('created_at', { ascending: false })

  if (observersError) {
    console.error('Error fetching observers:', observersError)
  }

  // Fetch all users
  const { data: users, error: usersError } = await supabaseAdmin
    .from('profiles')
    .select('id, email, display_name, role, created_at')
    .order('created_at', { ascending: false })

  if (usersError) {
    console.error('Error fetching users:', usersError)
  }

  // Fetch pending/rejected team moderation queue
  const { data: teamQueue, error: teamQueueError } = await supabaseAdmin
    .from('teams')
    .select(
      `
      id,
      name,
      tag,
      logo_path,
      metadata,
      approval_status,
      approval_notes,
      created_at,
      profiles!teams_submitted_by_profile_id_fkey (
        id,
        display_name,
        email
      )
    `
    )
    .in('approval_status', ['pending', 'rejected'])
    .order('created_at', { ascending: false })

  if (teamQueueError) {
    console.error('Error fetching team queue:', teamQueueError)
  }

  // Fetch approved teams list
  const { data: approvedTeams, error: approvedTeamsError } = await supabaseAdmin
    .from('teams')
    .select(
      `
      id,
      name,
      tag,
      logo_path,
      metadata,
      approval_status,
      created_at
      ,profiles!teams_submitted_by_profile_id_fkey (
        id,
        display_name,
        email
      )
    `
    )
    .eq('approval_status', 'approved')
    .order('created_at', { ascending: false })

  if (approvedTeamsError) {
    console.error('Error fetching approved teams:', approvedTeamsError)
  }

  const approvedTeamIds = (approvedTeams ?? []).map((team) => team.id)
  let captainMap = new Map<string, { display_name: string | null; email: string | null }>()

  if (approvedTeamIds.length > 0) {
    const { data: captainRows, error: captainRowsError } = await supabaseAdmin
      .from('team_memberships')
      .select(
        `
        team_id,
        player_registration!team_memberships_profile_id_fkey (
          profiles!player_registration_profile_id_fkey (
            display_name,
            email
          )
        )
      `
      )
      .in('team_id', approvedTeamIds)
      .eq('role', 'captain')
      .eq('is_active', true)
      .is('left_at', null)

    if (captainRowsError) {
      console.error('Error fetching approved team captains:', captainRowsError)
    } else {
      captainMap = new Map(
        (captainRows ?? []).map((row: any) => {
          const rel = Array.isArray(row.player_registration)
            ? row.player_registration[0]
            : row.player_registration
          const profileRel = Array.isArray(rel?.profiles) ? rel.profiles[0] : rel?.profiles
          return [
            row.team_id,
            {
              display_name: profileRel?.display_name ?? null,
              email: profileRel?.email ?? null,
            },
          ]
        })
      )
    }
  }

  const withLogoUrl = (teams: any[]) =>
    teams.map((team) => ({
      ...team,
      logo_url: team.logo_path
        ? supabaseAdmin.storage.from('team-logos').getPublicUrl(team.logo_path).data.publicUrl
        : null,
      captain_profile: captainMap.get(team.id) ?? null,
    }))

  return {
    players: players || [],
    observers: observers || [],
    users: users || [],
    teamQueue: withLogoUrl(teamQueue || []),
    approvedTeams: withLogoUrl(approvedTeams || []),
  }
}
