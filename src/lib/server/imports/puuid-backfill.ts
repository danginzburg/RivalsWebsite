import { supabaseAdmin } from '$lib/supabase/admin'

type Matcher = {
  resolve: (playerName: string, puuid?: string | null) => string | null
  resolveByPuuid: (puuid: string) => string | null
}

/**
 * Attach PUUIDs to Riot account rows that were matched only by name.
 *
 * Match imports carry a PUUID for every player. When a known account has no
 * PUUID stored yet (a signup that could not verify, or a backfilled legacy
 * row), we can fill it in from the payload so the next import matches that
 * account by PUUID — the key that survives a rename. Best-effort: a conflict
 * (the PUUID already belongs to another account) is skipped, not fatal.
 *
 * Returns the number of account rows updated.
 */
export async function backfillRiotAccountPuuids(
  pairs: Array<{ riotId: string; puuid: string | null | undefined }>,
  matcher: Matcher
): Promise<number> {
  // One update per PUUID; the same player appears on every map of a series.
  const byPuuid = new Map<string, string>()
  for (const { riotId, puuid } of pairs) {
    if (puuid && riotId && !byPuuid.has(puuid)) byPuuid.set(puuid, riotId)
  }

  let updated = 0
  for (const [puuid, riotId] of byPuuid) {
    // Already stored against some account — nothing to heal.
    if (matcher.resolveByPuuid(puuid)) continue

    // Only touch accounts we can tie to a known profile by name.
    const profileId = matcher.resolve(riotId)
    if (!profileId) continue

    const baseName = riotId.split('#')[0].trim()
    if (!baseName) continue

    const { data, error } = await supabaseAdmin
      .from('profile_riot_accounts')
      .update({ riot_puuid: puuid, verified_at: new Date().toISOString() })
      .eq('profile_id', profileId)
      .is('riot_puuid', null)
      .ilike('riot_name', baseName)
      .select('id')

    if (error) {
      // Most likely the unique-PUUID index: the PUUID is on another account.
      console.warn('backfillRiotAccountPuuids: skipped', riotId, error.message)
      continue
    }
    updated += data?.length ?? 0
  }

  return updated
}
