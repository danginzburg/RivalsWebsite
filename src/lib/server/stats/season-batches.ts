/**
 * Which `rivals_group_stats` import batches make up a whole season, and how to
 * sum them into one line per player.
 *
 * Why this is a curated list
 * --------------------------
 * `stat_import_batches.season_id` is NULL on every rivals_group_stats row, so a
 * season cannot be resolved from the batch table. Matching on `display_name` is
 * the other obvious route and it is a trap: Season 4's post-season files were
 * named with square brackets ("Season 4 Playoffs [NA]") while every earlier
 * season used parentheses, which is exactly how the play-ins and playoffs got
 * silently dropped from "All Time (NA)". See
 * `supabase/queries/set_all_time_na_source_batches.sql`.
 *
 * The double-counting trap
 * ------------------------
 * Several Season 4 batches overlap and must never both appear in one list:
 *   - "Season 4 [NA] Play-ins + Playoffs" is exactly the sum of the separate
 *     play-ins and playoffs batches. Take either the combined one or the two
 *     parts, never both.
 *   - "Season 4 [NA] Weeks 1-N" are cumulative snapshots already contained in
 *     "Season 4 (NA)", and the `weekly` batches are single weeks of the same.
 *     Neither belongs here.
 *   - EMEA batches are a separate region, not part of the NA season totals.
 */

/** Curated non-overlapping batch ids per season `code`. */
const SEASON_STAT_BATCHES: Record<string, string[]> = {
  rivals1: [
    'df70872a-82c0-4f06-9ccc-ed122c2bfea4', // Season 1 (NA)
    'b608880b-050b-4041-8995-54d04b6ebadc', // Season 1 Playoffs (NA)
  ],
  rivals2: [
    'd695bc85-4115-4045-bc49-c179dcc691b8', // Season 2 (NA)
    '7b292e04-6d76-4663-b651-6e734c093e4e', // Season 2 Playoffs (NA)
  ],
  rivals3: [
    'f6500391-c86f-422c-812a-14817db9f4b1', // Season 3 (NA)
    'a8a259b9-841d-4ec5-b518-6de923d5f9c2', // Season 3 Playoffs (NA)
  ],
  rivals4: [
    '65ba73f4-1f38-47c3-82b9-2dbd775999a0', // Season 4 Kickoff (NA)
    '9d7b560e-9af8-4744-b3e5-6b8894e34ce1', // Season 4 (NA) — regular season
    '01b97f98-0841-4ce2-8b8c-11c1e3c3dc91', // Season 4 Play-ins [NA]
    '45326410-2225-4e8f-b8ab-56413412c27c', // Season 4 Playoffs [NA]
  ],
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type SeasonRef = {
  code?: string | null
  metadata?: { stat_batches?: unknown } | null
}

/**
 * Batch ids that sum to the season's totals.
 *
 * `seasons.metadata.stat_batches` wins when present so a newly imported event
 * can be folded in from the DB without a deploy; otherwise the curated list
 * above is used. Returns `[]` for a season we have no stats for.
 */
export function resolveSeasonStatBatchIds(season: SeasonRef | null | undefined): string[] {
  const override = season?.metadata?.stat_batches
  if (Array.isArray(override)) {
    const ids = override.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id))
    if (ids.length > 0) return Array.from(new Set(ids))
  }
  return SEASON_STAT_BATCHES[season?.code ?? ''] ?? []
}

/** Roster-facing subset of `rivals_group_stats`. */
export type SeasonStatRow = {
  profile_id?: string | null
  player_name?: string | null
  games?: number | null
  rounds?: number | null
  kills?: number | null
  deaths?: number | null
  acs?: number | null
  kd?: number | null
  adr?: number | null
}

export type AggregatedSeasonStat = {
  acs: number | null
  kd: number | null
  adr: number | null
  games: number
}

/** Names are matched case-insensitively; imports are inconsistent about casing. */
export function normalizePlayerName(name: string | null | undefined): string | null {
  const trimmed = (name ?? '').trim().toLowerCase()
  return trimmed === '' ? null : trimmed
}

/**
 * A roster member to match stat rows against. `names` holds every alias worth
 * trying — the membership's player name, plus `riot_id_base` and
 * `stats_player_name` from the profile when it is claimed.
 */
export type RosterRef = { profile_id?: string | null; names: Array<string | null | undefined> }

/**
 * Rows belonging to one roster member, across every season batch.
 *
 * Matched by `profile_id` when both sides have one, and otherwise by name — the
 * same identity rule the SQL aggregates use
 * (`coalesce(profile_id::text, lower(trim(player_name)))`). The name fallback is
 * not optional here: most kickoff and regular-season rows were imported before
 * players claimed their profiles and still have a NULL `profile_id`, so without
 * it a claimed player would silently lose the events that predate their claim.
 *
 * A row already claimed by a *different* profile is never name-matched, so two
 * players sharing a display name cannot bleed into each other.
 */
function rowsForMember(member: RosterRef, rows: SeasonStatRow[]): SeasonStatRow[] {
  const memberProfileId = member.profile_id ?? null
  const memberNames = new Set(
    member.names.map(normalizePlayerName).filter((n): n is string => n !== null)
  )

  return rows.filter((row) => {
    const rowProfileId = row.profile_id ?? null
    if (memberProfileId && rowProfileId) return rowProfileId === memberProfileId
    if (rowProfileId && memberProfileId) return false
    const rowName = normalizePlayerName(row.player_name)
    return rowName !== null && memberNames.has(rowName)
  })
}

/**
 * Sum a player's per-event rows into one season line.
 *
 * ACS and ADR are rate stats, so they are averaged weighted by rounds (falling
 * back to games) rather than added — matching
 * `supabase/queries/refresh_generated_rivals_group_stats_batch.sql`. K/D is
 * recomputed from total kills and deaths, never averaged.
 */
export function aggregateSeasonStats(rows: SeasonStatRow[]): AggregatedSeasonStat | null {
  if (rows.length === 0) return null

  let weight = 0
  let acsWeighted = 0
  let adrWeighted = 0
  let kdWeighted = 0
  let games = 0
  let kills = 0
  let deaths = 0

  for (const row of rows) {
    const rowWeight = (row.rounds || row.games || 0) as number
    games += row.games ?? 0
    kills += row.kills ?? 0
    deaths += row.deaths ?? 0
    if (rowWeight > 0) {
      weight += rowWeight
      acsWeighted += (row.acs ?? 0) * rowWeight
      adrWeighted += (row.adr ?? 0) * rowWeight
      kdWeighted += (row.kd ?? 0) * rowWeight
    }
  }

  return {
    acs: weight > 0 ? acsWeighted / weight : null,
    adr: weight > 0 ? adrWeighted / weight : null,
    // Totals are the honest K/D. Some older imports carry a `kd` column with no
    // kills/deaths behind it, so fall back to the weighted average of those.
    kd: deaths > 0 ? kills / deaths : weight > 0 ? kdWeighted / weight : null,
    games,
  }
}

/** Season totals per roster member, positionally aligned with `roster`. */
export function aggregateRoster(
  roster: RosterRef[],
  rows: SeasonStatRow[]
): Array<AggregatedSeasonStat | null> {
  return roster.map((member) => aggregateSeasonStats(rowsForMember(member, rows)))
}
