import { error, redirect } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'

export const load = async ({ locals }: { locals: App.Locals }) => {
  if (!locals.user) {
    throw redirect(303, '/auth/login?returnTo=/admin/matches-import')
  }

  await requireAdmin(locals.user)

  const [
    { data: profiles, error: profilesError },
    { data: teams, error: teamsError },
    { data: seasons, error: seasonsError },
  ] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id, display_name, riot_id_base, stats_player_name')
      .order('display_name', { ascending: true }),
    supabaseAdmin
      .from('teams')
      .select('id, name, tag, metadata, season_id')
      .eq('approval_status', 'approved')
      .order('name', { ascending: true }),
    supabaseAdmin
      .from('seasons')
      .select('id, name, code, is_active')
      .order('is_active', { ascending: false })
      .order('starts_on', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
  ])

  if (profilesError) throw error(500, 'Failed to load profiles')
  if (teamsError) throw error(500, 'Failed to load teams')
  if (seasonsError) throw error(500, 'Failed to load seasons')

  const activeSeasonId = (seasons ?? []).find((s) => s.is_active)?.id ?? null

  return {
    profiles: profiles ?? [],
    teams: teams ?? [],
    seasons: seasons ?? [],
    activeSeasonId,
  }
}
