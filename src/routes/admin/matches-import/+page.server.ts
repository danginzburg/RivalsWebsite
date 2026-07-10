import { error, redirect } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'

export const load = async ({ locals }: { locals: App.Locals }) => {
  if (!locals.user) {
    throw redirect(303, '/auth/login?returnTo=/admin/matches-import')
  }

  await requireAdmin(locals.user)

  const [{ data: profiles, error: profilesError }, { data: teams, error: teamsError }] =
    await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('id, display_name, riot_id_base, stats_player_name')
        .order('display_name', { ascending: true }),
      supabaseAdmin
        .from('teams')
        .select('id, name, tag, metadata')
        .eq('approval_status', 'approved')
        .order('name', { ascending: true }),
    ])

  if (profilesError) throw error(500, 'Failed to load profiles')
  if (teamsError) throw error(500, 'Failed to load teams')

  return {
    profiles: profiles ?? [],
    teams: teams ?? [],
  }
}
