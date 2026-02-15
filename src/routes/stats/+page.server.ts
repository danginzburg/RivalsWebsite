import type { PageServerLoad } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'

export const load: PageServerLoad = async ({ fetch, url, locals }) => {
  const batchId = url.searchParams.get('batchId')

  const res = await fetch(
    `/api/stats?limit=200${batchId ? `&batchId=${encodeURIComponent(batchId)}` : ''}`
  )

  const body = await res.json().catch(() => ({}))

  let viewer: { profileId: string; displayName: string | null } | null = null
  if (locals.user) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name')
      .eq('auth0_sub', locals.user.sub)
      .maybeSingle()

    if (profile?.id) {
      viewer = { profileId: profile.id, displayName: profile.display_name ?? null }
    }
  }

  let batches: any[] = []
  const { data: batchRows, error: batchError } = await supabaseAdmin
    .from('stat_import_batches')
    .select('id, source_filename, display_name, import_kind, week_label, created_at, metadata')
    .filter('metadata->>import_type', 'eq', 'rivals_group_stats')
    .order('created_at', { ascending: false })
    .limit(100)

  if (!batchError) {
    batches = (batchRows ?? []).map((b: any) => ({
      id: b.id,
      source_filename: b.source_filename,
      display_name: b.display_name ?? b.source_filename,
      import_kind: b.import_kind ?? b.metadata?.import_kind ?? null,
      week_label: b.week_label ?? b.metadata?.week_label ?? null,
      created_at: b.created_at,
    }))
  }

  return {
    batchId: body.batchId ?? null,
    batch: body.batch ?? null,
    rows: body.rows ?? [],
    batches,
    viewer,
  }
}
