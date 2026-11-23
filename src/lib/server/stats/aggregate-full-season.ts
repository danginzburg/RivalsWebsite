/**
 * Sum many `rivals_group_stats` rows (a season's phase batches) into one line
 * per player, producing rows shaped exactly like a real batch's rows so the
 * stats API and page cannot tell a generated full-season batch from an imported
 * one.
 *
 * This is the in-memory twin of
 * `supabase/queries/refresh_generated_rivals_group_stats_batch.sql`, which
 * materializes the "All Time (NA)" batch the same way. The identity rule, the
 * rounds-then-games weighting for rate stats, and the recompute-don't-average
 * treatment of per-game/per-round rates all match that query so the two paths
 * agree to the digit.
 *
 * Difference from the SQL: multikills and clutches are honest counting stats, so
 * they are summed here. The SQL predates those columns and leaves them null; a
 * generated season total is new surface, so it carries the better data.
 * `league_rank` is the rank from the player's latest phase: a player holds one
 * rank per phase, and the most recent is the one they finished the season on.
 *
 * A stat no phase row recorded (clutches and multikills before Season 5, say)
 * stays null rather than summing to a zero that reads as real data.
 */

/** Counting stats: added straight across every row. */
const SUM_FIELDS = [
  'games',
  'games_won',
  'games_lost',
  'rounds',
  'rounds_won',
  'rounds_lost',
  'kills',
  'deaths',
  'assists',
  'fk',
  'fd',
  'plants',
  'defuses',
  'mk_2k',
  'mk_3k',
  'mk_4k',
  'mk_5k',
  'mk_6k',
  'mk_7k',
  'clutches_won',
  'clutches_attempted',
] as const

/** Rate stats: averaged weighted by rounds (falling back to games). */
const WEIGHTED_FIELDS = ['acs', 'kast_pct', 'adr', 'hs_pct', 'econ_rating'] as const

type NumRecord = Record<string, unknown>

/** Whether a row actually recorded this stat (null/blank means it was not tracked). */
function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** rounds, else games, else 0 — matching `coalesce(nullif(rounds,0), nullif(games,0), 0)`. */
function rowWeight(row: NumRecord): number {
  const rounds = num(row.rounds)
  if (rounds > 0) return rounds
  const games = num(row.games)
  return games > 0 ? games : 0
}

/** A ratio that is null (not zero) when the denominator is missing. */
function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null
}

type Acc = {
  key: string
  profileId: string | null
  bestName: string
  bestGames: number
  bestRounds: number
  agents: Map<string, string>
  sums: Record<string, number>
  /** Fields at least one of the player's rows recorded; the rest come out null. */
  seen: Set<string>
  weightedSums: Record<string, number>
  weightTotal: number
  rank: string | null
  rankImportedAt: string
}

/** `profile_id` when present, else the lowercased name — the SQL's `player_key`. */
function playerKey(row: NumRecord): string | null {
  const profileId = typeof row.profile_id === 'string' ? row.profile_id.trim() : ''
  if (profileId) return profileId
  const name = typeof row.player_name === 'string' ? row.player_name.trim().toLowerCase() : ''
  return name === '' ? null : name
}

export type AggregatedFullSeasonRow = Record<string, unknown> & {
  id: string
  profile_id: string | null
  player_name: string | null
  import_batch_id: string
}

/**
 * @param rows raw `rivals_group_stats` rows from the season's phase batches
 * @param virtualBatchId the `season:<code>` id, stamped onto every output row
 */
export function aggregateFullSeasonRows(
  rows: NumRecord[],
  virtualBatchId: string
): AggregatedFullSeasonRow[] {
  const byPlayer = new Map<string, Acc>()

  for (const row of rows) {
    const key = playerKey(row)
    if (key === null) continue

    let acc = byPlayer.get(key)
    if (!acc) {
      acc = {
        key,
        profileId: null,
        bestName: '',
        bestGames: -1,
        bestRounds: -1,
        agents: new Map(),
        sums: Object.fromEntries(SUM_FIELDS.map((f) => [f, 0])),
        seen: new Set(),
        weightedSums: Object.fromEntries(WEIGHTED_FIELDS.map((f) => [f, 0])),
        weightTotal: 0,
        rank: null,
        rankImportedAt: '',
      }
      byPlayer.set(key, acc)
    }

    // Latest phase's rank wins; ISO timestamps compare as strings.
    const rank = typeof row.league_rank === 'string' ? row.league_rank.trim() : ''
    const importedAt = typeof row.imported_at === 'string' ? row.imported_at : ''
    if (rank && importedAt >= acc.rankImportedAt) {
      acc.rank = rank
      acc.rankImportedAt = importedAt
    }

    // First non-null profile id wins, like `min(profile_id) filter (...)`.
    if (!acc.profileId && typeof row.profile_id === 'string' && row.profile_id.trim()) {
      acc.profileId = row.profile_id.trim()
    }

    // The display name from the row with the most games (then rounds).
    const games = num(row.games)
    const rounds = num(row.rounds)
    const name = typeof row.player_name === 'string' ? row.player_name : ''
    if (name && (games > acc.bestGames || (games === acc.bestGames && rounds > acc.bestRounds))) {
      acc.bestName = name
      acc.bestGames = games
      acc.bestRounds = rounds
    }

    if (typeof row.agents === 'string') {
      for (const token of row.agents.split(/\s+/)) {
        const trimmed = token.trim()
        if (trimmed === '') continue
        const lower = trimmed.toLowerCase()
        if (!acc.agents.has(lower)) acc.agents.set(lower, trimmed)
      }
    }

    for (const field of SUM_FIELDS) {
      if (hasValue(row[field])) acc.seen.add(field)
      acc.sums[field] += num(row[field])
    }

    const weight = rowWeight(row)
    if (weight > 0) {
      acc.weightTotal += weight
      for (const field of WEIGHTED_FIELDS) {
        if (hasValue(row[field])) acc.seen.add(field)
        acc.weightedSums[field] += num(row[field]) * weight
      }
    }
  }

  const out: AggregatedFullSeasonRow[] = []

  for (const acc of byPlayer.values()) {
    // A sum of a stat no row recorded is null, not 0.
    const s = Object.fromEntries(
      SUM_FIELDS.map((f) => [f, acc.seen.has(f) ? acc.sums[f] : null])
    ) as Record<(typeof SUM_FIELDS)[number], number | null>
    const weighted = (field: (typeof WEIGHTED_FIELDS)[number]): number | null =>
      acc.weightTotal > 0 && acc.seen.has(field) ? acc.weightedSums[field] / acc.weightTotal : null
    const per = (numerator: number | null, denominator: number | null): number | null =>
      numerator == null || denominator == null ? null : ratio(numerator, denominator)

    const agents =
      acc.agents.size > 0
        ? Array.from(acc.agents.entries())
            .sort((a, z) => a[0].localeCompare(z[0]))
            .map(([, label]) => label)
            .join(' ')
        : null

    out.push({
      id: `${virtualBatchId}:${acc.key}`,
      import_batch_id: virtualBatchId,
      profile_id: acc.profileId,
      player_name: acc.bestName || null,
      agents,
      games: s.games,
      games_won: s.games_won,
      games_lost: s.games_lost,
      rounds: s.rounds,
      rounds_won: s.rounds_won,
      rounds_lost: s.rounds_lost,
      kills: s.kills,
      deaths: s.deaths,
      assists: s.assists,
      fk: s.fk,
      fd: s.fd,
      plants: s.plants,
      defuses: s.defuses,
      mk_2k: s.mk_2k,
      mk_3k: s.mk_3k,
      mk_4k: s.mk_4k,
      mk_5k: s.mk_5k,
      mk_6k: s.mk_6k,
      mk_7k: s.mk_7k,
      clutches_won: s.clutches_won,
      clutches_attempted: s.clutches_attempted,
      acs: weighted('acs'),
      kast_pct: weighted('kast_pct'),
      adr: weighted('adr'),
      hs_pct: weighted('hs_pct'),
      econ_rating: weighted('econ_rating'),
      // Totals are the honest K/D; per-game and per-round rates are recomputed
      // from the summed counts, never averaged from the phase rates.
      kd: per(s.kills, s.deaths),
      kpg: per(s.kills, s.games),
      kpr: per(s.kills, s.rounds),
      dpg: per(s.deaths, s.games),
      dpr: per(s.deaths, s.rounds),
      apg: per(s.assists, s.games),
      apr: per(s.assists, s.rounds),
      fkpg: per(s.fk, s.games),
      fdpg: per(s.fd, s.games),
      plants_per_game: per(s.plants, s.games),
      defuses_per_game: per(s.defuses, s.games),
      league_rank: acc.rank,
    })
  }

  return out
}
