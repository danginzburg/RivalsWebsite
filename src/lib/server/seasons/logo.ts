import { supabaseAdmin } from '$lib/supabase/admin'

/**
 * Season logos share the `team-logos` bucket — same visibility rules, and a
 * second bucket would only add configuration to keep in sync.
 */
export function getSeasonLogoUrl(
  season: { logo_path?: string | null } | null | undefined
): string | null {
  if (!season?.logo_path) return null
  return supabaseAdmin.storage.from('team-logos').getPublicUrl(season.logo_path).data.publicUrl
}
