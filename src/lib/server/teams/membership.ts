import { supabaseAdmin } from '$lib/supabase/admin'
import { relinkTeamMembershipsForClaim } from '$lib/server/players/claim-relink'
import type { ProfileRow } from '$lib/server/imports/matching'

function normalize(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export async function getActiveMemberships(profileId: string) {
  const { data, error } = await supabaseAdmin
    .from('team_memberships')
    .select('team_id, role')
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .is('left_at', null)

  if (error) {
    throw new Error('Failed to load team memberships')
  }

  return data ?? []
}

export function isCaptainLike(role: string | null | undefined) {
  return role === 'captain' || role === 'manager'
}

export async function resolveProfileIdForPlayerName(playerName: string) {
  const normalizedName = normalize(playerName)
  if (!normalizedName) return null

  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, riot_id_base, stats_player_name')

  if (profilesError) throw new Error('Failed to load profiles for roster matching')

  const matchedProfile = ((profiles ?? []) as ProfileRow[]).find((profile) =>
    [profile.display_name, profile.riot_id_base, profile.stats_player_name]
      .map((value) => normalize(value))
      .includes(normalizedName)
  )

  if (matchedProfile?.id) return matchedProfile.id

  const { data: statsMatches, error: statsError } = await supabaseAdmin
    .from('rivals_group_stats')
    .select('profile_id, imported_at')
    .eq('player_name', playerName)
    .not('profile_id', 'is', null)
    .order('imported_at', { ascending: false })
    .limit(10)

  if (statsError) throw new Error('Failed to load matched stats players for roster matching')

  const profileIds = Array.from(
    new Set(
      (statsMatches ?? []).map((row) => row.profile_id).filter((id): id is string => Boolean(id))
    )
  )

  return profileIds.length === 1 ? profileIds[0] : null
}

/** @returns Count of name-only memberships linked to this profile (not duplicates deactivated). */
export async function rematchNamedTeamMemberships(profileId: string) {
  const result = await relinkTeamMembershipsForClaim(profileId)
  return result.linked
}
