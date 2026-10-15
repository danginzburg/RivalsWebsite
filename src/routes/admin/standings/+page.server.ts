import { error, redirect } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { calculateSeasonStandings } from '$lib/server/leaderboard/computed'
import { isComputedBatch, pickStandingsBatch } from '$lib/server/leaderboard/batch'

type SeasonRow = { id: string; name: string; is_active: boolean | null }

export const load = async ({ locals, url }: { locals: App.Locals; url: URL }) => {
  if (!locals.user) {
    throw redirect(303, '/auth/login?returnTo=/admin/standings')
  }
  await requireAdmin(locals.user)

  const { data: seasons, error: seasonsError } = await supabaseAdmin
    .from('seasons')
    .select('id, name, is_active')
    .order('is_active', { ascending: false })
    .order('starts_on', { ascending: false, nullsFirst: false })
  if (seasonsError) throw error(500, 'Failed to load seasons')

  const list = (seasons ?? []) as SeasonRow[]
  const requested = url.searchParams.get('season')
  const seasonId =
    list.find((s) => s.id === requested)?.id ?? list.find((s) => s.is_active)?.id ?? list[0]?.id

  if (!seasonId) return { seasons: list, seasonId: null, standings: null, publishedSource: null }

  const [standings, { data: batches }] = await Promise.all([
    calculateSeasonStandings(seasonId),
    // What the public pages are showing right now.
    supabaseAdmin
      .from('stat_import_batches')
      .select('id, display_name, created_at, metadata')
      .eq('season_id', seasonId)
      .filter('metadata->>import_type', 'eq', 'leaderboard_entries')
      .eq('status', 'applied')
      .order('created_at', { ascending: false }),
  ])

  const latest = pickStandingsBatch(
    (batches ?? []) as Array<{
      id: string
      display_name: string | null
      created_at: string
      metadata: Record<string, unknown> | null
    }>
  )
  const latestMeta = (latest?.metadata ?? {}) as Record<string, unknown>
  return {
    seasons: list,
    seasonId,
    standings,
    publishedSource: latest
      ? {
          computed: isComputedBatch(latest),
          label: (latestMeta.display_name as string | undefined) ?? latest.display_name ?? null,
          at: latest.created_at as string,
        }
      : null,
  }
}
