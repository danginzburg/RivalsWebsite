import type { PageServerLoad } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'

export const load: PageServerLoad = async () => {
  const { data: matches, error: matchesError } = await supabaseAdmin
    .from('matches')
    .select(
      `
      id,
      status,
      best_of,
      scheduled_at,
      started_at,
      ended_at,
      team_a_score,
      team_b_score,
      team_a:teams!matches_team_a_id_fkey (id, name, tag, logo_path),
      team_b:teams!matches_team_b_id_fkey (id, name, tag, logo_path)
    `
    )
    .eq('approval_status', 'approved')
    .in('status', ['scheduled', 'live'])
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .limit(5)

  if (matchesError) {
    console.error('Failed to load home matches:', matchesError)
  }

  return {
    matches: matches ?? [],
  }
}
