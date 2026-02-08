import { error } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'

export const load = async ({ params, locals }: { params: { id: string }; locals: App.Locals }) => {
  const matchId = params.id
  if (!matchId) throw error(400, 'Missing match id')

  let viewerProfileId: string | null = null
  let viewerRole: string | null = null
  if (locals.user) {
    const { data: viewerProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('auth0_sub', locals.user.sub)
      .maybeSingle()

    viewerProfileId = viewerProfile?.id ?? null
    viewerRole = viewerProfile?.role ?? null
  }

  const { data: match, error: matchError } = await supabaseAdmin
    .from('matches')
    .select(
      `
      id,
      status,
      approval_status,
      best_of,
      scheduled_at,
      started_at,
      ended_at,
      team_a_id,
      team_b_id,
      team_a_score,
      team_b_score,
      winner_team_id,
      metadata,
      team_a:teams!matches_team_a_id_fkey (id, name, tag),
      team_b:teams!matches_team_b_id_fkey (id, name, tag)
    `
    )
    .eq('id', matchId)
    .maybeSingle()

  if (matchError || !match) throw error(404, 'Match not found')
  if (match.approval_status !== 'approved') throw error(404, 'Match not found')

  const { data: streams } = await supabaseAdmin
    .from('match_streams')
    .select('id, match_id, platform, stream_url, is_primary, status, created_at')
    .eq('match_id', matchId)
    .order('is_primary', { ascending: false })

  const { data: vetoActions } = await supabaseAdmin
    .from('match_map_veto_actions')
    .select(
      'id, match_id, acting_team_id, acting_profile_id, action_type, map_name, action_order, created_at'
    )
    .eq('match_id', matchId)
    .order('action_order', { ascending: true })

  let pendingResultReport: any | null = null
  const { data: pendingReport, error: pendingReportError } = await supabaseAdmin
    .from('match_result_reports')
    .select(
      'id, match_id, status, reporting_team_id, team_a_score, team_b_score, winner_team_id, notes, evidence_url, created_at'
    )
    .eq('match_id', matchId)
    .eq('status', 'pending')
    .maybeSingle()

  if (pendingReportError) {
    // Table may not exist until migration is applied.
    pendingResultReport = null
  } else {
    pendingResultReport = pendingReport ?? null
  }

  let viewer: {
    isLoggedIn: boolean
    isAdmin: boolean
    isCaptainLike: boolean
    profileId: string | null
  } = {
    isLoggedIn: Boolean(locals.user),
    isAdmin: viewerRole === 'admin',
    isCaptainLike: false,
    profileId: viewerProfileId,
  }

  if (viewerProfileId && viewerRole !== 'restricted' && viewerRole !== 'banned') {
    const { data: memberships } = await supabaseAdmin
      .from('team_memberships')
      .select('team_id, role')
      .eq('profile_id', viewerProfileId)
      .eq('is_active', true)
      .is('left_at', null)

    const isCaptainLike = (role: string | null | undefined) =>
      role === 'captain' || role === 'manager'
    viewer.isCaptainLike = (memberships ?? []).some(
      (m) => isCaptainLike(m.role) && [match.team_a_id, match.team_b_id].includes(m.team_id)
    )
  }

  return {
    match: {
      ...match,
      streams: streams ?? [],
      vetoActions: vetoActions ?? [],
      pendingResultReport,
    },
    viewer,
  }
}
