import { error, redirect } from '@sveltejs/kit'
import { requireProfile } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { getActiveMemberships, isCaptainLike } from '$lib/server/teams/membership'
import { bo3VetoSteps, getRemainingMaps, normalizeMapPool } from '$lib/matches/veto'

async function canManageMatch(profileId: string, role: string | undefined, matchId: string) {
  if (role === 'admin') return true

  const { data: match } = await supabaseAdmin
    .from('matches')
    .select('id, approval_status, team_a_id, team_b_id')
    .eq('id', matchId)
    .maybeSingle()

  if (!match || match.approval_status !== 'approved') return false

  const memberships = await getActiveMemberships(profileId)
  return memberships.some(
    (m) => [match.team_a_id, match.team_b_id].includes(m.team_id) && isCaptainLike(m.role)
  )
}

export const load = async ({ params, locals }: { params: { id: string }; locals: App.Locals }) => {
  if (!locals.user) throw redirect(303, `/auth/login?returnTo=/matches/${params.id}/veto`)
  const profile = await requireProfile(locals.user)

  const allowed = await canManageMatch(profile.id, profile.role, params.id)
  if (!allowed) throw redirect(303, `/matches/${params.id}`)

  const { data: match } = await supabaseAdmin
    .from('matches')
    .select(
      `
      id,
      best_of,
      team_a_id,
      team_b_id,
      metadata,
      team_a:teams!matches_team_a_id_fkey (id, name, tag),
      team_b:teams!matches_team_b_id_fkey (id, name, tag)
    `
    )
    .eq('id', params.id)
    .single()

  if (!match) throw error(404, 'Match not found')

  const memberships = await getActiveMemberships(profile.id)
  const viewerTeamIds = memberships
    .filter((m) => isCaptainLike(m.role))
    .map((m) => m.team_id)
    .filter((id) => [match.team_a_id, match.team_b_id].includes(id))

  const { data: actions } = await supabaseAdmin
    .from('match_map_veto_actions')
    .select(
      'id, match_id, acting_team_id, acting_profile_id, action_type, map_name, action_order, created_at'
    )
    .eq('match_id', params.id)
    .order('action_order', { ascending: true })

  const mapPool = normalizeMapPool((match as any)?.metadata?.map_pool)
  const remainingMaps = getRemainingMaps(mapPool, (actions ?? []) as any)

  let next: any = { done: true, reason: 'Veto complete', nextOrder: (actions ?? []).length + 1 }
  if ((match as any).best_of === 3) {
    const startingTeamId =
      typeof (match as any)?.metadata?.veto_starting_team_id === 'string'
        ? (match as any).metadata.veto_starting_team_id
        : null
    const starting =
      startingTeamId && [match.team_a_id, match.team_b_id].includes(startingTeamId)
        ? startingTeamId
        : match.team_a_id

    const other = starting === match.team_a_id ? match.team_b_id : match.team_a_id
    const steps = bo3VetoSteps(starting, other)
    const step = steps[(actions ?? []).length]
    next = step
      ? {
          done: false,
          nextOrder: (actions ?? []).length + 1,
          actingTeamId: step.actingTeamId,
          actionType: step.actionType,
        }
      : {
          done: true,
          reason: 'Veto complete',
          nextOrder: (actions ?? []).length + 1,
          actingTeamId: null,
          actionType: null,
        }
  } else {
    next = {
      done: true,
      reason: 'Veto only implemented for BO3',
      nextOrder: (actions ?? []).length + 1,
      actingTeamId: null,
      actionType: null,
    }
  }

  return {
    match,
    actions: actions ?? [],
    mapPool,
    remainingMaps,
    next,
    viewer: { role: profile.role ?? null, profileId: profile.id, teamIds: viewerTeamIds },
  }
}
