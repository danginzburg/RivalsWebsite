import { error } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'

export const load = async ({ params, locals }: { params: { id: string }; locals: App.Locals }) => {
  const teamId = params.id

  let isAdmin = false
  let viewerProfileId: string | null = null
  if (locals.user) {
    const { data: viewerProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('auth0_sub', locals.user.sub)
      .maybeSingle()

    viewerProfileId = viewerProfile?.id ?? null
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

  const { data: viewerMembership } = viewerProfileId
    ? await supabaseAdmin
        .from('team_memberships')
        .select('id')
        .eq('team_id', teamId)
        .eq('profile_id', viewerProfileId)
        .eq('is_active', true)
        .is('left_at', null)
        .maybeSingle()
    : { data: null }

  if (team.approval_status !== 'approved' && !isAdmin && !viewerMembership) {
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

  const activeProfileIds = new Set(roster.map((player) => player.profile_id))

  const { data: inviteRows } = await supabaseAdmin
    .from('team_invites')
    .select('invited_profile_id, status')
    .eq('team_id', teamId)
    .in('status', ['pending', 'accepted'])

  const pendingInviteProfileIds = (inviteRows ?? [])
    .filter((invite) => !activeProfileIds.has(invite.invited_profile_id))
    .map((invite) => invite.invited_profile_id)

  let invitedPlayers: Array<{
    profile_id: string
    riot_id: string
    rank_label: string | null
    display_name: string | null
    email: string | null
    status: 'pending' | 'accepted'
  }> = []

  if (pendingInviteProfileIds.length > 0) {
    const { data: invitedRows } = await supabaseAdmin
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
      .in('profile_id', pendingInviteProfileIds)

    const inviteStatusMap = new Map(
      (inviteRows ?? []).map((invite) => [
        invite.invited_profile_id,
        invite.status as 'pending' | 'accepted',
      ])
    )

    invitedPlayers = (invitedRows ?? []).map((row: any) => {
      const profileRel = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
      return {
        profile_id: row.profile_id,
        riot_id: row.riot_id,
        rank_label: row.rank_label ?? null,
        display_name: profileRel?.display_name ?? null,
        email: profileRel?.email ?? null,
        status: inviteStatusMap.get(row.profile_id) ?? 'pending',
      }
    })
  }

  // Fallback: include players present in metadata.initial_roster but missing invite rows,
  // so older seeded/team records still show pending teammates.
  const metadataRoster = Array.isArray((team as any).metadata?.initial_roster)
    ? ((team as any).metadata.initial_roster as Array<{
        profile_id?: string
        riot_id?: string
        rank_label?: string
      }>)
    : []

  const invitedProfileIdSet = new Set(invitedPlayers.map((player) => player.profile_id))

  const metadataFallbackPlayers = metadataRoster
    .filter((entry) => entry.profile_id)
    .filter((entry) => !activeProfileIds.has(entry.profile_id!))
    .filter((entry) => !invitedProfileIdSet.has(entry.profile_id!))
    .map((entry) => ({
      profile_id: entry.profile_id!,
      riot_id: entry.riot_id ?? 'Unknown',
      rank_label: entry.rank_label ?? null,
      display_name: null,
      email: null,
      status: 'pending' as const,
    }))

  invitedPlayers = [...invitedPlayers, ...metadataFallbackPlayers]

  invitedPlayers.sort((a, b) => a.riot_id.localeCompare(b.riot_id))

  return {
    team: {
      ...team,
      logo_url: logoUrl,
    },
    roster,
    invitedPlayers,
  }
}
