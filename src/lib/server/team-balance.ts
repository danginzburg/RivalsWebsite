import { supabaseAdmin } from '$lib/supabase/admin'
import {
  DEFAULT_MAX_IMMORTAL_TOTAL,
  DEFAULT_MAX_TEAM_AVERAGE,
  isValidImmortalCap,
  isValidTeamCap,
} from '$lib/team-balance'

/** Stored as a `site_content` row, which every admin-saved site setting lives in. */
const CAP_KEY = 'team-balance'

export type TeamCap = {
  maxAverage: number
  /** Highest combined score of a roster's Immortal-peak players. */
  maxImmortalTotal: number
  /** No admin has saved a cap yet, so the calculator is using the built-in default. */
  isDefault: boolean
}

/** Falls back to the defaults so the public calculator never fails on this row. */
export async function loadTeamCap(): Promise<TeamCap> {
  const { data, error } = await supabaseAdmin
    .from('site_content')
    .select('document')
    .eq('key', CAP_KEY)
    .maybeSingle()
  if (error) console.error('[team-balance] failed to load cap', error.message)

  const doc = (data?.document ?? null) as {
    maxAverage?: unknown
    maxImmortalTotal?: unknown
  } | null
  // A cap saved before the Immortal rule existed has no Immortal total: use the default.
  const maxImmortalTotal = isValidImmortalCap(doc?.maxImmortalTotal)
    ? doc.maxImmortalTotal
    : DEFAULT_MAX_IMMORTAL_TOTAL
  return isValidTeamCap(doc?.maxAverage)
    ? { maxAverage: doc.maxAverage, maxImmortalTotal, isDefault: false }
    : { maxAverage: DEFAULT_MAX_TEAM_AVERAGE, maxImmortalTotal, isDefault: true }
}

export async function saveTeamCap(
  caps: { maxAverage: number; maxImmortalTotal: number },
  profileId: string
): Promise<void> {
  const { error } = await supabaseAdmin.from('site_content').upsert({
    key: CAP_KEY,
    document: { maxAverage: caps.maxAverage, maxImmortalTotal: caps.maxImmortalTotal },
    updated_by_profile_id: profileId,
  })
  if (error) throw new Error(error.message)
}
