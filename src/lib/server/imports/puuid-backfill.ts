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

    const { data: target } = await supabaseAdmin
      .from('riot_accounts')
      .select('id')
      .eq('profile_id', profileId)
      .is('puuid', null)
      .ilike('riot_name', baseName)
      .limit(1)
      .maybeSingle()
    if (!target) continue

    // An earlier import may have recorded this PUUID as an unowned account.
    // It is the same Riot account, so fold its sightings into the owned row.
    const { data: unowned } = await supabaseAdmin
      .from('riot_accounts')
      .select('id, first_seen_at, last_seen_at')
      .eq('puuid', puuid)
      .is('profile_id', null)
      .maybeSingle()
    if (unowned) await supabaseAdmin.from('riot_accounts').delete().eq('id', unowned.id)

    const { data, error } = await supabaseAdmin
      .from('riot_accounts')
      .update({
        puuid,
        verified_at: new Date().toISOString(),
        ...(unowned && {
          first_seen_at: unowned.first_seen_at,
          last_seen_at: unowned.last_seen_at,
        }),
      })
      .eq('id', target.id)
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
