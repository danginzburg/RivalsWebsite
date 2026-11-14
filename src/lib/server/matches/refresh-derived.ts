import { supabaseAdmin } from '$lib/supabase/admin'
import { refreshStandingsForSeason } from '$lib/server/leaderboard/computed'
import { refreshLiveBatchesForMatch } from '$lib/server/stats/from-matches'
import { invalidateSeasonSeeds } from '$lib/server/seasons/seeds'
import { syncSeasonAccoladesSafely } from '$lib/server/accolades/season-sync'
import { applyMatchStatReassignments } from '$lib/server/matches/reassignments'
import { rebuildPlayerMatchStats } from '$lib/server/imports/matching'

export type RefreshedBatch = { batchId: string; displayName: string | null; playerCount: number }

/**
 * Everything derived from a match result, rebuilt after it is imported, edited,
 * approved or deleted. One place, so every write path refreshes the same set:
 *
 * - manual stat reassignments re-applied to the map rows (and the series
 *   aggregate rebuilt if any row had drifted)
 * - calculated standings (leaderboard) for the match's season, plus any season
 *   it was just moved out of (`previousSeasonId`)
 * - playoff seeds, which fill seeds 5–8 from standings order
 * - live stat batches covering the match, the All Time batch and the Hall of
 *   Fame stat records (all via `refreshLiveBatchesForMatch`)
 * - automatic season accolades (pick'em champion, placements)
 *
 * Best-effort throughout: the match itself is already saved, and each piece has
 * a manual fallback in admin (Recalculate, Regenerate, Rebuild now, Sync).
 */
export async function refreshDerivedDataForMatch(options: {
  matchId: string
  adminProfileId: string
  previousSeasonId?: string | null
}): Promise<RefreshedBatch[]> {
  const { matchId, adminProfileId, previousSeasonId } = options

  // Manual stat reassignments (alt account → real player) win over whatever
  // the write path left on the rows. Re-applying here self-heals any path that
  // rewrote profile_id, so the moved match stays in the target's history and
  // the series aggregate below credits them.
  try {
    if ((await applyMatchStatReassignments(matchId)) > 0) await rebuildPlayerMatchStats(matchId)
  } catch (err) {
    console.warn('refreshDerivedDataForMatch: reassignment re-apply failed', matchId, err)
  }

  const { data: match } = await supabaseAdmin
    .from('matches')
    .select('season_id')
    .eq('id', matchId)
    .maybeSingle()
  const seasonIds = [
    ...new Set(
      [match?.season_id as string | null | undefined, previousSeasonId].filter((id): id is string =>
        Boolean(id)
      )
    ),
  ]

  // Standings first: seeds and accolades below read them.
  for (const seasonId of seasonIds) {
    await refreshStandingsForSeason(seasonId, adminProfileId)
    invalidateSeasonSeeds(seasonId)
  }

  const refreshedBatches = await refreshLiveBatchesForMatch({ matchId, adminProfileId })

  if (seasonIds.length > 0) await syncSeasonAccoladesSafely({ seasonIds })

  return refreshedBatches
}
