import { redirect, error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'
import { errorMessage } from '$lib/server/errors'
import { withSectionFallback } from '$lib/server/stats/rivals-batch'

type StatBatchRow = {
  id: string
  display_name: string | null
  source_filename: string | null
  import_kind: string | null
  week_label: string | null
  section: string | null
  created_at: string
  row_count: number | null
  metadata: {
    import_kind?: string | null
    week_label?: string | null
    generated_from_matches?: boolean
    auto_refresh?: boolean
    source_season_id?: string | null
    source_stages?: unknown
  } | null
  sort_order: number | null
}

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    throw redirect(303, '/auth/login?returnTo=/admin/stats-import')
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, role')
    .eq('auth0_sub', locals.user.sub)
    .single()

  if (profileError || !profile) {
    throw error(403, 'Profile not found')
  }

  if (profile.role !== 'admin') {
    throw error(403, 'Access denied. Administrator privileges required.')
  }

  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, riot_id_base')
    .order('display_name', { ascending: true })

  if (profilesError) {
    const msg = errorMessage(profilesError)
    if (msg.toLowerCase().includes('riot_id_base')) {
      throw error(500, 'Database missing profiles.riot_id_base; apply the Supabase migration')
    }
    throw error(500, msg || 'Failed to load profiles')
  }

  // Week label suggestions (best-effort; migrations may not be applied yet).
  const weekLabels: string[] = []
  {
    const { data: batches, error: batchesError } = await supabaseAdmin
      .from('stat_import_batches')
      .select('week_label, import_kind')
      .eq('import_kind', 'weekly')
      .not('week_label', 'is', null)
      .order('created_at', { ascending: false })
      .limit(200)

    if (!batchesError) {
      const seen = new Set<string>()
      for (const b of batches ?? []) {
        const w = String((b as { week_label?: string | null }).week_label ?? '').trim()
        if (!w) continue
        const key = w.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        weekLabels.push(w)
      }
    }
  }

  // Seasons the batch generator can be scoped to.
  const { data: seasonRows } = await supabaseAdmin
    .from('seasons')
    .select('id, code, name, is_active')
    .order('starts_on', { ascending: false, nullsFirst: false })

  return {
    profiles: profiles ?? [],
    weekLabels,
    seasons: (seasonRows ?? []).map((s) => ({
      id: s.id as string,
      code: (s.code as string | null) ?? null,
      name: (s.name as string | null) ?? null,
      is_active: Boolean(s.is_active),
    })),
    // For manual ordering, sectioning and ID visibility.
    batches: await (async () => {
      const { data: rows, error: batchError } = await withSectionFallback<StatBatchRow[]>(
        (select) =>
          supabaseAdmin
            .from('stat_import_batches')
            .select(select)
            .filter('metadata->>import_type', 'eq', 'rivals_group_stats')
            .order('sort_order', { ascending: true, nullsFirst: false })
            .order('created_at', { ascending: false })
            .limit(200)
            .returns<StatBatchRow[]>()
      )

      if (batchError) return []

      return (rows ?? []).map((b) => ({
        id: b.id,
        display_name: b.display_name ?? b.source_filename ?? b.id,
        import_kind: b.import_kind ?? b.metadata?.import_kind ?? null,
        week_label: b.week_label ?? b.metadata?.week_label ?? null,
        section: b.section ?? null,
        created_at: b.created_at,
        sort_order: b.sort_order ?? null,
        row_count: b.row_count ?? 0,
        // Only these can be rebuilt from their source matches.
        generated: Boolean(b.metadata?.generated_from_matches),
        // Live batches rebuild themselves on every covered match import.
        auto_refresh: Boolean(b.metadata?.auto_refresh),
        season_id: b.metadata?.source_season_id ?? null,
      }))
    })(),
  }
}
