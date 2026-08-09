import type { LayoutServerLoad } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'

export const load: LayoutServerLoad = async ({ locals }) => {
  const { data: activeSeason } = await supabaseAdmin
    .from('seasons')
    .select('id, metadata')
    .eq('is_active', true)
    .maybeSingle()

  const pickemMeta = activeSeason?.metadata as Record<string, unknown> | null
  const pickemConfig = pickemMeta?.playoff_pickem as Record<string, unknown> | undefined
  const hasActivePickem = Boolean(pickemConfig?.enabled && pickemConfig?.status !== 'draft')

  return {
    user: locals.user,
    hasActivePickem,
  }
}
