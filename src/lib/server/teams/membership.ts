import { supabaseAdmin } from '$lib/supabase/admin'

type ProfileRow = {
  id: string
  display_name: string | null
  riot_id_base: string | null
  stats_player_name?: string | null
}

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

export async function rematchNamedTeamMemberships(profileId: string) {
  const { data: activeMembership } = await supabaseAdmin
    .from('team_memberships')
    .select('id')
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .is('left_at', null)
    .maybeSingle()

  if (activeMembership?.id) return 0

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, riot_id_base, stats_player_name')
    .eq('id', profileId)
    .maybeSingle()

  if (profileError || !profile) throw new Error('Failed to load profile for team rematch')

  const names = Array.from(
    new Set(
      [profile.display_name, profile.riot_id_base, (profile as any).stats_player_name]
        .map((value) => normalize(value))
        .filter(Boolean)
    )
  )

  if (names.length === 0) return 0

  const { data: memberships, error: membershipsError } = await supabaseAdmin
    .from('team_memberships')
    .select('id, player_name, profile_id')
    .is('profile_id', null)
    .eq('is_active', true)
    .is('left_at', null)

  if (membershipsError) throw new Error('Failed to load named team memberships')

  const matchingIds = (memberships ?? [])
    .filter((membership) => names.includes(normalize((membership as any).player_name)))
    .map((membership) => membership.id)

  if (matchingIds.length === 0) return 0

  const { error: updateError } = await supabaseAdmin
    .from('team_memberships')
    .update({ profile_id: profileId })
    .in('id', matchingIds)

  if (updateError) throw new Error('Failed to link named team memberships')
  return matchingIds.length
}
