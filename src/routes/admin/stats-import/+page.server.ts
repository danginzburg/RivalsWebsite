import { redirect, error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'

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
    const msg = String((profilesError as any).message ?? '')
    if (msg.toLowerCase().includes('riot_id_base')) {
      throw error(500, 'Database missing profiles.riot_id_base; apply the Supabase migration')
    }
    throw error(500, msg || 'Failed to load profiles')
  }

  // Week label suggestions (best-effort; migrations may not be applied yet).
  let weekLabels: string[] = []
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
        const w = String((b as any).week_label ?? '').trim()
        if (!w) continue
        const key = w.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        weekLabels.push(w)
      }
    }
  }

  return {
    profiles: profiles ?? [],
    weekLabels,
    // For manual ordering and ID visibility.
    batches: await (async () => {
      const { data: rows, error: batchError } = await supabaseAdmin
        .from('stat_import_batches')
        .select(
          'id, display_name, source_filename, import_kind, week_label, created_at, metadata, sort_order'
        )
        .filter('metadata->>import_type', 'eq', 'rivals_group_stats')
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(200)

      if (batchError) return []

      return (rows ?? []).map((b: any) => ({
        id: b.id,
        display_name: b.display_name ?? b.source_filename ?? b.id,
        import_kind: b.import_kind ?? b.metadata?.import_kind ?? null,
        week_label: b.week_label ?? b.metadata?.week_label ?? null,
        created_at: b.created_at,
        sort_order: b.sort_order ?? null,
      }))
    })(),
  }
}
