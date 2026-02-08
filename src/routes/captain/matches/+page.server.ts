import { redirect } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { requireProfile } from '$lib/server/auth/profile'
import { isCaptainLike } from '$lib/server/teams/membership'

export const load = async ({ locals }: { locals: App.Locals }) => {
  if (!locals.user) {
    throw redirect(303, '/auth/login?returnTo=/captain/matches')
  }

  const profile = await requireProfile(locals.user)

  const { data: memberships } = await supabaseAdmin
    .from('team_memberships')
    .select('team_id, role')
    .eq('profile_id', profile.id)
    .eq('is_active', true)
    .is('left_at', null)

  const captainTeamIds = (memberships ?? [])
    .filter((m) => isCaptainLike(m.role))
    .map((m) => m.team_id)

  let captainTeams: Array<{ id: string; name: string; tag: string | null }> = []
  if (captainTeamIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('teams')
      .select('id, name, tag')
      .in('id', captainTeamIds)
      .eq('approval_status', 'approved')
      .order('name', { ascending: true })
    captainTeams = data ?? []
  }

  const { data: allOpponents } = await supabaseAdmin
    .from('teams')
    .select('id, name, tag')
    .eq('approval_status', 'approved')
    .order('name', { ascending: true })

  let proposals: any[] = []
  if (captainTeamIds.length > 0) {
    const filters = [
      ...captainTeamIds.map((id) => `proposed_by_team_id.eq.${id}`),
      ...captainTeamIds.map((id) => `opponent_team_id.eq.${id}`),
    ]

    const { data } = await supabaseAdmin
      .from('match_proposals')
      .select(
        `
        id,
        status,
        best_of,
        proposed_start_at,
        notes,
        created_at,
        proposed_by_team_id,
        opponent_team_id,
        proposed_team:teams!match_proposals_proposed_by_team_id_fkey (id, name, tag),
        opponent_team:teams!match_proposals_opponent_team_id_fkey (id, name, tag)
      `
      )
      .or(filters.join(','))
      .order('created_at', { ascending: false })

    proposals = data ?? []
  }

  return {
    captainTeams,
    opponentTeams: (allOpponents ?? []).filter((t) => !captainTeamIds.includes(t.id)),
    proposals,
    captainTeamIds,
  }
}
