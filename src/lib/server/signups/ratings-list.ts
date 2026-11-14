import { supabaseAdmin } from '$lib/supabase/admin'
import { loadPlayerDirectory } from '$lib/server/players/directory'
import { effectiveValue } from '$lib/server/signups'

export type SignupRatingRow = {
  profileId: string
  riotId: string | null
  discord: string | null
  /** Final score: formula plus adjustment, or the manual override. */
  score: number | null
}

export type SignupRatingsList = {
  rows: SignupRatingRow[]
  /** True when no signup is approved yet: only admins get the list then. */
  preview: boolean
}

/**
 * The season's approved players' ratings, replacing the admin CSV export.
 * Public once at least one signup is approved; before that, only admins see
 * the section.
 */
export async function loadSignupRatings(
  seasonId: string,
  { isAdmin }: { isAdmin: boolean }
): Promise<SignupRatingsList | null> {
  const approved = await loadApprovedRows(seasonId)
  if (approved.length > 0) return { rows: approved, preview: false }
  return isAdmin ? { rows: approved, preview: true } : null
}

async function loadApprovedRows(seasonId: string) {
  const { data, error } = await supabaseAdmin
    .from('player_signups')
    .select('profile_id, discord_handle, computed_value, manual_value_override, manual_adjustment')
    .eq('season_id', seasonId)
    .eq('status', 'approved')
  if (error) {
    console.error('Failed to load signup ratings:', error)
    return []
  }
  if (!data?.length) return []

  const directory = await loadPlayerDirectory(data.map((s) => s.profile_id))
  const rows: SignupRatingRow[] = data.map((signup) => {
    const player = directory.get(signup.profile_id)
    const name = player?.riot_name?.trim()
    const tag = player?.riot_tag?.trim()
    return {
      profileId: signup.profile_id,
      riotId: name ? (tag ? `${name}#${tag}` : name) : null,
      discord: signup.discord_handle || player?.discord_username || null,
      score: effectiveValue(signup),
    }
  })

  // Highest first; unscored players last, then by name.
  return rows.sort(
    (a, b) =>
      (b.score ?? -Infinity) - (a.score ?? -Infinity) ||
      (a.riotId ?? '').localeCompare(b.riotId ?? '')
  )
}
