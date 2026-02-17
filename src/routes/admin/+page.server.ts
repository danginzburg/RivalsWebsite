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
      profile_id,
      riot_id,
      rank_label,
      rank_value,
      pronouns,
      tracker_links,
      created_at,
      updated_at,
      profiles!player_registration_profile_id_fkey (
        id,
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
      profile_id,
      has_previous_experience,
      can_stream_quality,
      willing_to_use_overlay,
      additional_info,
      created_at,
      updated_at,
      profiles (
        id,
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

  // Fetch pending team moderation queue
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
    .eq('approval_status', 'pending')
    .order('created_at', { ascending: false })

  if (teamQueueError) {
    console.error('Error fetching team queue:', teamQueueError)
  }

  // Fetch approved teams for dedicated admin section
  const { data: approvedTeams, error: approvedTeamsError } = await supabaseAdmin
    .from('teams')
    .select(
      `
      id,
      name,
      tag,
      logo_path,
      approval_status,
      created_at
    `
    )
    .eq('approval_status', 'approved')
    .order('created_at', { ascending: false })

  if (approvedTeamsError) {
    console.error('Error fetching approved teams:', approvedTeamsError)
  }

  const approvedTeamIds = (approvedTeams ?? []).map((team) => team.id)
  let approvedCaptainMap = new Map<string, { display_name: string | null; email: string | null }>()
  let approvedRosterCountMap = new Map<string, number>()
  let approvedRosterMap = new Map<
    string,
    Array<{
      profile_id: string
      role: string
      riot_id: string
      display_name: string | null
      email: string | null
    }>
  >()

  if (approvedTeamIds.length > 0) {
    const { data: captainRows } = await supabaseAdmin
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

    approvedCaptainMap = new Map(
      (captainRows ?? []).map((row: any) => {
        const reg = Array.isArray(row.player_registration)
          ? row.player_registration[0]
          : row.player_registration
        const profileRel = Array.isArray(reg?.profiles) ? reg.profiles[0] : reg?.profiles
        return [
          row.team_id,
          {
            display_name: profileRel?.display_name ?? null,
            email: profileRel?.email ?? null,
          },
        ]
      })
    )

    const { data: rosterRows } = await supabaseAdmin
      .from('team_memberships')
      .select(
        `
        team_id,
        profile_id,
        role,
        player_registration!team_memberships_profile_id_fkey (
          riot_id,
          profiles!player_registration_profile_id_fkey (
            display_name,
            email
          )
        )
      `
      )
      .in('team_id', approvedTeamIds)
      .eq('is_active', true)
      .is('left_at', null)

    approvedRosterCountMap = new Map<string, number>()
    approvedRosterMap = new Map()
    for (const row of rosterRows ?? []) {
      approvedRosterCountMap.set(row.team_id, (approvedRosterCountMap.get(row.team_id) ?? 0) + 1)

      const reg = Array.isArray((row as any).player_registration)
        ? (row as any).player_registration[0]
        : (row as any).player_registration
      const profileRel = Array.isArray(reg?.profiles) ? reg.profiles[0] : reg?.profiles

      const rosterEntry = {
        profile_id: row.profile_id,
        role: row.role,
        riot_id: reg?.riot_id ?? 'Unknown',
        display_name: profileRel?.display_name ?? null,
        email: profileRel?.email ?? null,
      }

      const current = approvedRosterMap.get(row.team_id) ?? []
      current.push(rosterEntry)
      approvedRosterMap.set(row.team_id, current)
    }
  }

  const withLogoUrl = (teams: any[]) =>
    teams.map((team) => ({
      ...team,
      logo_url: team.logo_path
        ? supabaseAdmin.storage.from('team-logos').getPublicUrl(team.logo_path).data.publicUrl
        : null,
      captain_profile: approvedCaptainMap.get(team.id) ?? null,
      roster_count: approvedRosterCountMap.get(team.id) ?? 0,
      roster: approvedRosterMap.get(team.id) ?? [],
    }))

  const { data: matchProposals, error: matchProposalsError } = await supabaseAdmin
    .from('match_proposals')
    .select(
      `
      id,
      status,
      best_of,
      proposed_start_at,
      notes,
      approval_notes,
      created_at,
      proposed_by_team_id,
      opponent_team_id,
      proposed_team:teams!match_proposals_proposed_by_team_id_fkey (id, name, tag),
      opponent_team:teams!match_proposals_opponent_team_id_fkey (id, name, tag)
    `
    )
    .order('created_at', { ascending: false })

  if (matchProposalsError) {
    console.error('Error fetching match proposals:', matchProposalsError)
  }

  const { data: matches, error: matchesError } = await supabaseAdmin
    .from('matches')
    .select(
      `
      id,
      status,
      approval_status,
      best_of,
      scheduled_at,
      team_a_id,
      team_b_id,
      winner_team_id,
      team_a_score,
      team_b_score,
      team_a:teams!matches_team_a_id_fkey (id, name, tag),
      team_b:teams!matches_team_b_id_fkey (id, name, tag)
    `
    )
    .order('created_at', { ascending: false })

  if (matchesError) {
    console.error('Error fetching matches:', matchesError)
  }

  let pendingResultReports: any[] = []
  const { data: reports, error: reportsError } = await supabaseAdmin
    .from('match_result_reports')
    .select(
      'id, match_id, status, reporting_team_id, team_a_score, team_b_score, winner_team_id, notes, evidence_url, created_at'
    )
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (reportsError) {
    // Table may not exist until migration is applied.
    pendingResultReports = []
  } else {
    pendingResultReports = reports ?? []
  }

  return {
    players: players || [],
    observers: observers || [],
    users: users || [],
    teamQueue: withLogoUrl(teamQueue || []),
    approvedTeams: withLogoUrl(approvedTeams || []),
    matchProposals: matchProposals ?? [],
    matches: matches ?? [],
    pendingResultReports,
  }
}
