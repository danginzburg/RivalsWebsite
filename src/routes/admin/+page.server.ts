import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'
import { requireAdmin } from '$lib/server/auth/profile'

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    throw redirect(303, '/auth/login?returnTo=/admin')
  }

  await requireAdmin(locals.user)

  // Fetch all users
  const { data: users, error: usersError } = await supabaseAdmin
    .from('profiles')
    .select('id, email, display_name, role, created_at')
    .order('created_at', { ascending: false })

  if (usersError) {
    console.error('Error fetching users:', usersError)
  }

  // Teams are admin-managed; load approved teams.
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
  const approvedCaptainMap = new Map<
    string,
    { display_name: string | null; email: string | null }
  >()
  const approvedRosterCountMap = new Map<string, number>()
  const approvedRosterMap = new Map<
    string,
    Array<{
      profile_id: string
      role: string
      riot_id_base: string | null
      display_name: string | null
      email: string | null
    }>
  >()

  if (approvedTeamIds.length > 0) {
    const { data: rosterRows, error: rosterError } = await supabaseAdmin
      .from('team_memberships')
      .select('team_id, profile_id, role')
      .in('team_id', approvedTeamIds)
      .eq('is_active', true)
      .is('left_at', null)

    if (rosterError) {
      console.error('Error fetching team roster:', rosterError)
    } else {
      const profileIds = Array.from(new Set((rosterRows ?? []).map((r) => r.profile_id)))
      const profileById = new Map<string, any>()
      if (profileIds.length > 0) {
        const { data: profileRows, error: profilesError } = await supabaseAdmin
          .from('profiles')
          .select('id, display_name, email, riot_id_base')
          .in('id', profileIds)

        if (profilesError) {
          console.error('Error fetching roster profiles:', profilesError)
        } else {
          for (const p of profileRows ?? []) profileById.set(p.id, p)
        }
      }

      for (const row of rosterRows ?? []) {
        approvedRosterCountMap.set(row.team_id, (approvedRosterCountMap.get(row.team_id) ?? 0) + 1)
        const p = profileById.get(row.profile_id)
        const rosterEntry = {
          profile_id: row.profile_id,
          role: row.role,
          riot_id_base: p?.riot_id_base ?? null,
          display_name: p?.display_name ?? null,
          email: p?.email ?? null,
        }
        const current = approvedRosterMap.get(row.team_id) ?? []
        current.push(rosterEntry)
        approvedRosterMap.set(row.team_id, current)

        if (row.role === 'captain') {
          approvedCaptainMap.set(row.team_id, {
            display_name: p?.display_name ?? null,
            email: p?.email ?? null,
          })
        }
      }
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

  return {
    users: users || [],
    approvedTeams: withLogoUrl(approvedTeams || []),
    matches: matches ?? [],
  }
}
