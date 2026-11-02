import { supabaseAdmin } from '$lib/supabase/admin'
import { loadPlayerDirectory } from '$lib/server/players/directory'
import { fetchAllRows } from '$lib/server/supabase/fetch-all'

/**
 * Player ratings — the input to the signup score bonus.
 *
 * Loaded once from an externally calculated sheet; this module is the seam to
 * swap for an internal calculation later. The sheet only has names, and they
 * are whatever a player was called at the time, so a rating is matched to a
 * player through every name they are known by — see `pickRating`.
 */

export type PlayerRating = {
  rating: number
  /** The name on the sheet, which can differ from the player's Riot name. */
  name: string
}

/** The names to try for a player, strongest evidence first. */
export type RatingCandidates = {
  riotName: string | null
  /** Other approved Riot accounts, and the names on the player's stat rows. */
  knownNames: string[]
  discordUsername: string | null
}

export function ratingNameKey(name: string | null | undefined): string {
  return String(name ?? '')
    .split('#')[0]
    .trim()
    .toLowerCase()
}

/**
 * A player's rating from their candidate names, and how it was found. Custom
 * display names are deliberately not candidates: a player can type anything
 * into theirs. A Discord username is the last resort and weak evidence, so the
 * caller checks that the sheet name is not another player's.
 */
export function pickRating(
  candidates: RatingCandidates,
  ratings: Map<string, PlayerRating>
): { rating: PlayerRating; via: 'riot' | 'discord' } | null {
  for (const name of [candidates.riotName, ...candidates.knownNames]) {
    const rating = ratings.get(ratingNameKey(name))
    if (rating) return { rating, via: 'riot' }
  }
  const rating = ratings.get(ratingNameKey(candidates.discordUsername))
  return rating ? { rating, via: 'discord' } : null
}

/** Sheet rows for the given names, keyed by `ratingNameKey`. */
async function loadRatingRows(
  names: Array<string | null | undefined>
): Promise<Map<string, PlayerRating>> {
  const keys = [...new Set(names.map(ratingNameKey).filter(Boolean))]
  const ratings = new Map<string, PlayerRating>()

  // Chunked so a large signup list stays well under URL length limits.
  for (let i = 0; i < keys.length; i += 200) {
    const { data, error } = await supabaseAdmin
      .from('player_ratings')
      .select('player_name, name_key, rating')
      .in('name_key', keys.slice(i, i + 200))
    if (error) throw new Error(error.message)
    for (const row of data ?? []) {
      ratings.set(row.name_key, { rating: Number(row.rating), name: row.player_name })
    }
  }

  return ratings
}

/** Names on each player's stat rows, most used first. */
async function statNamesByProfile(
  players: Array<{ profile_id: string; puuids: string[] }>
): Promise<Map<string, string[]>> {
  const profileByPuuid = new Map(players.flatMap((p) => p.puuids.map((id) => [id, p.profile_id])))
  const counts = new Map<string, Map<string, number>>()
  const count = (profileId: string | undefined | null, name: string | null) => {
    if (!profileId || !name) return
    const names = counts.get(profileId) ?? new Map<string, number>()
    names.set(name, (names.get(name) ?? 0) + 1)
    counts.set(profileId, names)
  }

  const profileIds = players.map((p) => p.profile_id)
  for (let i = 0; i < profileIds.length; i += 100) {
    const ids = profileIds.slice(i, i + 100)
    const [groupRows, mapRows] = await Promise.all([
      fetchAllRows<{ player_name: string; profile_id: string }>(() =>
        supabaseAdmin
          .from('rivals_group_stats')
          .select('player_name, profile_id')
          .in('profile_id', ids)
          .order('id')
      ),
      fetchAllRows<{ player_name: string; profile_id: string }>(() =>
        supabaseAdmin
          .from('player_match_map_stats')
          .select('player_name, profile_id')
          .in('profile_id', ids)
          .order('id')
      ),
    ])
    for (const row of [...groupRows, ...mapRows]) count(row.profile_id, row.player_name)
  }

  const puuids = [...profileByPuuid.keys()]
  for (let i = 0; i < puuids.length; i += 50) {
    const chunk = puuids.slice(i, i + 50)
    const rows = await fetchAllRows<{ player_name: string; puuid: string }>(() =>
      supabaseAdmin
        .from('player_match_map_stats')
        .select('player_name, puuid')
        .in('puuid', chunk)
        .order('id')
    )
    for (const row of rows) count(profileByPuuid.get(row.puuid), row.player_name)
  }

  return new Map(
    [...counts].map(([profileId, names]) => [
      profileId,
      [...names].sort((a, b) => b[1] - a[1]).map(([name]) => name),
    ])
  )
}

/** Whether a sheet name is another player's Riot account or stat line. */
async function isOtherPlayersName(profileId: string, ratingName: string): Promise<boolean> {
  const pattern = ratingName.replace(/[\\%_]/g, '\\$&')
  const { data: accounts, error: accountError } = await supabaseAdmin
    .from('riot_accounts')
    .select('profile_id')
    .ilike('riot_name', pattern)
    .neq('profile_id', profileId)
    .limit(1)
  if (accountError) throw new Error(accountError.message)
  if (accounts?.length) return true

  // Stat names can carry a #tag, so match the prefix and compare keys.
  const { data: stats, error: statsError } = await supabaseAdmin
    .from('rivals_group_stats')
    .select('player_name')
    .ilike('player_name', `${pattern}%`)
    .neq('profile_id', profileId)
    .limit(50)
  if (statsError) throw new Error(statsError.message)
  return (stats ?? []).some((row) => ratingNameKey(row.player_name) === ratingNameKey(ratingName))
}

/** Ratings for the given players, keyed by profile id. */
export async function loadRatingsForPlayers(
  players: Array<{ profile_id: string; riot_name: string | null }>
): Promise<Map<string, PlayerRating>> {
  const found = new Map<string, PlayerRating>()

  const direct = await loadRatingRows(players.map((p) => p.riot_name))
  for (const player of players) {
    const rating = direct.get(ratingNameKey(player.riot_name))
    if (rating) found.set(player.profile_id, rating)
  }

  // Everyone else may be on the sheet under a name they no longer use.
  const unrated = players.filter((p) => !found.has(p.profile_id))
  if (unrated.length === 0) return found

  const directory = await loadPlayerDirectory(unrated.map((p) => p.profile_id))
  const entries = [...directory.values()]
  const statNames = await statNamesByProfile(entries)

  const candidates = unrated.map((player) => {
    const entry = directory.get(player.profile_id)
    return {
      profileId: player.profile_id,
      names: {
        riotName: player.riot_name,
        knownNames: [...(entry?.riot_ids ?? []), ...(statNames.get(player.profile_id) ?? [])],
        discordUsername: entry?.discord_username ?? null,
      } satisfies RatingCandidates,
    }
  })

  const ratings = await loadRatingRows(
    candidates.flatMap(({ names }) => [...names.knownNames, names.discordUsername])
  )

  for (const { profileId, names } of candidates) {
    const match = pickRating(names, ratings)
    if (!match) continue
    if (match.via === 'discord' && (await isOtherPlayersName(profileId, match.rating.name))) {
      continue
    }
    found.set(profileId, match.rating)
  }

  return found
}

export async function loadRatingFor(
  profileId: string,
  riotName: string | null | undefined
): Promise<number | null> {
  const ratings = await loadRatingsForPlayers([
    { profile_id: profileId, riot_name: riotName ?? null },
  ])
  return ratings.get(profileId)?.rating ?? null
}
