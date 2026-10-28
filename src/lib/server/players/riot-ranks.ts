import { supabaseAdmin } from '$lib/supabase/admin'
import { RiotLookupError, fetchPeakRankBetween, type LookupOptions } from '$lib/server/riot/henrik'

/**
 * Tournament ranks (`riot_season_ranks`): the highest rank each player held
 * between a season's start and end dates. Custom games never report a rank, so
 * it is read from the player's ranked match history instead.
 */

const DAY_MS = 24 * 60 * 60_000

/**
 * The window a season's ranks are taken over: its start date through the end
 * of its end date. A missing date falls back to the season's first or last
 * match, and a season with no end yet runs to now.
 */
export async function seasonRankWindow(seasonId: string): Promise<{ start: Date; end: Date }> {
  const [{ data: season }, { data: first }, { data: last }] = await Promise.all([
    supabaseAdmin.from('seasons').select('starts_on, ends_on').eq('id', seasonId).maybeSingle(),
    supabaseAdmin
      .from('matches')
      .select('scheduled_at')
      .eq('season_id', seasonId)
      .not('scheduled_at', 'is', null)
      .order('scheduled_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('matches')
      .select('scheduled_at')
      .eq('season_id', seasonId)
      .not('scheduled_at', 'is', null)
      .order('scheduled_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const now = Date.now()
  const start = season?.starts_on
    ? Date.parse(season.starts_on)
    : first?.scheduled_at
      ? Date.parse(first.scheduled_at)
      : now
  // `ends_on` is a date: the tournament runs through the whole of that day.
  const end = season?.ends_on
    ? Date.parse(season.ends_on) + DAY_MS
    : season?.starts_on || !last?.scheduled_at
      ? now
      : Date.parse(last.scheduled_at) + DAY_MS
  return { start: new Date(start), end: new Date(Math.max(start, end)) }
}

/**
 * Work out and store the tournament rank of each PUUID for one season.
 * Players with no ranked record in or near the window are left out.
 *
 * Best-effort and bounded by `deadline`: a rank is never a reason to fail or
 * stall an import, so players still waiting when time runs out keep whatever
 * rank they had stored.
 */
export async function refreshSeasonRanks(
  seasonId: string,
  puuids: string[],
  opts: LookupOptions = {}
): Promise<Map<string, string>> {
  const window = await seasonRankWindow(seasonId)
  const ranks = new Map<string, string>()
  for (const puuid of new Set(puuids.filter(Boolean))) {
    try {
      const rank = await fetchPeakRankBetween(puuid, window.start, window.end, opts)
      if (rank) ranks.set(puuid, rank)
    } catch (err) {
      // Out of rate-limit budget or past the deadline: leave the rest as they were.
      if (err instanceof RiotLookupError && err.status === 429) break
    }
  }
  if (ranks.size === 0) return ranks

  const now = new Date().toISOString()
  const { error } = await supabaseAdmin.from('riot_season_ranks').upsert(
    [...ranks].map(([puuid, rank]) => ({
      puuid,
      season_id: seasonId,
      rank,
      window_start: window.start.toISOString(),
      window_end: window.end.toISOString(),
      updated_at: now,
    })),
    { onConflict: 'puuid,season_id' }
  )
  if (error) throw new Error(`Failed to store season ranks: ${error.message}`)
  return ranks
}
