import { supabaseAdmin } from '$lib/supabase/admin'

export function getTeamLogoUrl(
  team: { logo_path?: string | null } | null | undefined
): string | null {
  if (!team?.logo_path) return null
  return supabaseAdmin.storage.from('team-logos').getPublicUrl(team.logo_path).data.publicUrl
}
