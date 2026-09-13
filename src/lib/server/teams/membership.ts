import { supabaseAdmin } from '$lib/supabase/admin'
import { relinkTeamMembershipsForClaim } from '$lib/server/players/claim-relink'
import type { ProfileRow } from '$lib/server/imports/matching'
import { fetchAccount, RiotLookupError } from '$lib/server/riot/henrik'

function normalize(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/** name#tag → the two parts, or null when there is no usable tag. */
function splitRiotId(value: string): { name: string; tag: string } | null {
  const raw = String(value ?? '').trim()
  const hash = raw.lastIndexOf('#')
  if (hash <= 0 || hash === raw.length - 1) return null
  return { name: raw.slice(0, hash).trim(), tag: raw.slice(hash + 1).trim() }
}

/**
 * The stable identity for a roster slot, resolved from whatever an admin typed.
 *
 * A roster slot is only useful for sub detection if it carries an identity that
 * also appears in the stats — a PUUID, or a profile that owns one. This resolves
 * the input to the best available identity:
 *   - a full Riot ID (name#tag) is matched against registered accounts, then
 *     verified against Riot to capture its PUUID when it is not on file;
 *   - a bare name falls back to the existing profile-by-name matching.
 *
 * `playerName` is preserved for display and as the last-resort match key.
 */
export async function resolveRosterIdentity(input: string): Promise<{
  profileId: string | null
  puuid: string | null
  playerName: string
}> {
  const playerName = String(input ?? '').trim()
  const parts = splitRiotId(playerName)

  let profileId: string | null = null
  let puuid: string | null = null

  // 1. A registered Riot account is the most direct hit — it carries both the
  //    profile and (usually) the PUUID.
  if (parts) {
    const { data: account } = await supabaseAdmin
      .from('profile_riot_accounts')
      .select('profile_id, riot_puuid')
      .ilike('riot_name', parts.name)
      .ilike('riot_tag', parts.tag)
      .maybeSingle()
    if (account) {
      profileId = (account.profile_id as string | null) ?? null
      puuid = (account.riot_puuid as string | null) ?? null
    }
  }

  // 2. Fall back to matching a profile by any of its names.
  if (!profileId) {
    profileId = await resolveProfileIdForPlayerName(parts ? parts.name : playerName)
  }

  // 3. Backfill a PUUID from the resolved profile's primary account.
  if (profileId && !puuid) {
    const { data: primary } = await supabaseAdmin
      .from('profile_riot_accounts')
      .select('riot_puuid')
      .eq('profile_id', profileId)
      .eq('is_primary', true)
      .maybeSingle()
    puuid = (primary?.riot_puuid as string | null) ?? null
  }

  // 4. Still no PUUID but we have a full Riot ID: verify it against Riot. This is
  //    what makes a brand-new, unregistered player matchable going forward. Any
  //    lookup failure is non-fatal — the slot is still created, just name-keyed.
  if (!puuid && parts) {
    try {
      const account = await fetchAccount(parts.name, parts.tag)
      puuid = account.puuid
      if (!profileId) {
        const { data: byPuuid } = await supabaseAdmin
          .from('profile_riot_accounts')
          .select('profile_id')
          .eq('riot_puuid', puuid)
          .maybeSingle()
        profileId = (byPuuid?.profile_id as string | null) ?? null
      }
    } catch (err) {
      if (!(err instanceof RiotLookupError)) throw err
    }
  }

  return { profileId, puuid, playerName }
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
