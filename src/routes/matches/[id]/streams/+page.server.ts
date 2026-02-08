import { redirect } from '@sveltejs/kit'
import { requireProfile } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { getActiveMemberships, isCaptainLike } from '$lib/server/teams/membership'

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
  if (!locals.user) throw redirect(303, `/auth/login?returnTo=/matches/${params.id}/streams`)
  const profile = await requireProfile(locals.user)

  if (profile.role === 'restricted' || profile.role === 'banned') {
    throw redirect(303, `/matches/${params.id}`)
  }

  const allowed = await canManageMatch(profile.id, profile.role, params.id)
  if (!allowed) throw redirect(303, `/matches/${params.id}`)

  const { data: match } = await supabaseAdmin
    .from('matches')
    .select(
      `
      id,
      scheduled_at,
      team_a:teams!matches_team_a_id_fkey (id, name, tag),
      team_b:teams!matches_team_b_id_fkey (id, name, tag)
    `
    )
    .eq('id', params.id)
    .single()

  const { data: streams } = await supabaseAdmin
    .from('match_streams')
    .select('id, match_id, platform, stream_url, is_primary, status, created_at')
    .eq('match_id', params.id)
    .order('is_primary', { ascending: false })

  return {
    match,
    streams: streams ?? [],
  }
}
