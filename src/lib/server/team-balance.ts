import { supabaseAdmin } from '$lib/supabase/admin'
import { DEFAULT_MAX_TEAM_AVERAGE, isValidTeamCap } from '$lib/team-balance'

/** Stored as a `site_content` row, which every admin-saved site setting lives in. */
const CAP_KEY = 'team-balance'

export type TeamCap = {
  maxAverage: number
  /** No admin has saved a cap yet, so the calculator is using the built-in default. */
  isDefault: boolean
}

/** Falls back to the default so the public calculator never fails on this row. */
export async function loadTeamCap(): Promise<TeamCap> {
  const { data, error } = await supabaseAdmin
    .from('site_content')
    .select('document')
    .eq('key', CAP_KEY)
    .maybeSingle()
  if (error) console.error('[team-balance] failed to load cap', error.message)

  const saved = (data?.document as { maxAverage?: unknown } | null)?.maxAverage
  return isValidTeamCap(saved)
    ? { maxAverage: saved, isDefault: false }
    : { maxAverage: DEFAULT_MAX_TEAM_AVERAGE, isDefault: true }
}

export async function saveTeamCap(maxAverage: number, profileId: string): Promise<void> {
  const { error } = await supabaseAdmin.from('site_content').upsert({
    key: CAP_KEY,
    document: { maxAverage },
    updated_by_profile_id: profileId,
  })
  if (error) throw new Error(error.message)
}
