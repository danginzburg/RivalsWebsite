import { supabaseAdmin } from '$lib/supabase/admin'

export async function getActiveMemberships(profileId: string) {
  const { data, error } = await supabaseAdmin
    .from('team_memberships')
    .select('team_id, role')
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .is('left_at', null)

  if (error) {
    throw new Error('Failed to load team memberships')
  }

  return data ?? []
}

export function isCaptainLike(role: string | null | undefined) {
  return role === 'captain' || role === 'manager'
}
