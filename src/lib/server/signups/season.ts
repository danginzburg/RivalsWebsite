import { supabaseAdmin } from '$lib/supabase/admin'

export type SignupSeason = { id: string; code: string; name: string }

/**
 * The season new signups are recorded against.
 *
 * A season explicitly flagged `signups_open` wins, so the next season's
 * registration can run while another event is still the active season.
 * Without one, the active season is used — but only a Rivals event, since an
 * external event takes its signups elsewhere and must never collect them here.
 */
export async function loadSignupSeason(): Promise<SignupSeason | null> {
  const { data: open } = await supabaseAdmin
    .from('seasons')
    .select('id, code, name')
    .eq('signups_open', true)
    .maybeSingle()
  if (open) return open

  const { data: active } = await supabaseAdmin
    .from('seasons')
    .select('id, code, name, kind')
    .eq('is_active', true)
    .maybeSingle()
  if (!active || active.kind === 'external') return null

  return { id: active.id, code: active.code, name: active.name }
}
