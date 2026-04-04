import { error, redirect } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'

export const load = async ({ locals }: { locals: App.Locals }) => {
  if (!locals.user) {
    throw redirect(303, '/auth/login?returnTo=/admin/leaderboard-import')
  }

  await requireAdmin(locals.user)

  const [
    { data: seasons, error: seasonsError },
    { data: teams, error: teamsError },
    { data: batches },
  ] = await Promise.all([
    supabaseAdmin
      .from('seasons')
      .select('id, code, name, is_active, starts_on, ends_on')
      .order('is_active', { ascending: false })
      .order('starts_on', { ascending: false, nullsFirst: false }),
    supabaseAdmin
      .from('teams')
      .select('id, name, tag, metadata')
      .eq('approval_status', 'approved')
      .order('tag', { ascending: true }),
    supabaseAdmin
      .from('stat_import_batches')
      .select('id, display_name, source_filename, created_at, metadata')
      .filter('metadata->>import_type', 'eq', 'leaderboard_entries')
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  if (seasonsError) throw error(500, 'Failed to load seasons')
  if (teamsError) throw error(500, 'Failed to load teams')

  return {
    seasons: seasons ?? [],
    teams: teams ?? [],
    recentBatches: batches ?? [],
  }
}
