import { error } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'

export const load = async ({ params, locals }: { params: { id: string }; locals: App.Locals }) => {
  const matchId = params.id
  if (!matchId) throw error(400, 'Missing match id')

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

  return {
    match: {
      ...match,
      streams: streams ?? [],
    },
    viewer: {
      isAdmin: locals.user?.role === 'admin',
    },
  }
}
