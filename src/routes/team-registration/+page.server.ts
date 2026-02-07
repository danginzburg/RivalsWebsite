import { supabaseAdmin } from '$lib/supabase/admin'

export const load = async ({ locals }: { locals: App.Locals }) => {
  type SubmissionRow = {
    id: string
    name: string
    tag: string | null
    approval_status: string
    approval_notes: string | null
    created_at: string
  }

  type RegisteredPlayerRow = {
    profile_id: string
    riot_id: string
    rank_label: string
    display_name: string | null
    email: string | null
  }

  type InviteRow = {
    id: string
    status: string
    role: string
    message: string | null
    created_at: string
    team_id: string
    teams:
      | {
          id: string
          name: string
          tag: string | null
          approval_status: string
          logo_path: string | null
        }[]
      | null
  }

  let mySubmissions: SubmissionRow[] = []
  let invites: InviteRow[] = []

  const { data: registeredPlayers, error: registeredPlayersError } = await supabaseAdmin
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
    .not('rank_label', 'is', null)
    .order('riot_id', { ascending: true })

  if (registeredPlayersError) {
    console.error('Failed to load registered players:', registeredPlayersError)
  }

  const normalizedRegisteredPlayers: RegisteredPlayerRow[] = (registeredPlayers ?? []).map(
    (row) => {
      const profileRel = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
      return {
        profile_id: row.profile_id,
        riot_id: row.riot_id,
        rank_label: row.rank_label,
        display_name: profileRel?.display_name ?? null,
        email: profileRel?.email ?? null,
      }
    }
  )

  if (locals.user) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('auth0_sub', locals.user.sub)
      .single()

    if (profile) {
      const { data: submittedTeams } = await supabaseAdmin
        .from('teams')
        .select('id, name, tag, approval_status, approval_notes, created_at')
        .eq('submitted_by_profile_id', profile.id)
        .order('created_at', { ascending: false })

      mySubmissions = submittedTeams ?? []

      const { data: inviteRows } = await supabaseAdmin
        .from('team_invites')
        .select(
          `
          id,
          status,
          role,
          message,
          created_at,
          team_id,
          teams (
            id,
            name,
            tag,
            approval_status,
            logo_path
          )
        `
        )
        .eq('invited_profile_id', profile.id)
        .in('status', ['pending', 'accepted'])
        .order('created_at', { ascending: false })

      invites = inviteRows ?? []
    }
  }

  return {
    mySubmissions,
    registeredPlayers: normalizedRegisteredPlayers,
    invites,
  }
}
