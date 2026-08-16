import { supabaseAdmin } from '$lib/supabase/admin'
import { average, sum } from '$lib/server/math'

/**
 * Build a `rivals_group_stats` batch from Riot-imported match data.
 *
 * Why a batch rather than a live view: the /stats page reads
 * `rivals_group_stats`, and every row there is a snapshot from an import. There
 * is no join between it and `player_match_map_stats`, and adding one would mean
 * the page silently changed as matches were imported — which is the opposite of
 * what a "Season 4 Playoffs" snapshot is for. Generating a batch keeps imported
 * matches in the same shape as everything else, so the batch picker, sorting
 * and column toggles all work without special cases.
 *
 * Only maps that actually carry advanced stats are included. A CSV-imported map
 * has NULL multikills, and averaging those in would quietly understate whoever
 * played in both.
 */

export type GenerateOptions = {
  /** Restrict to one season. Omitted means every imported match. */
  seasonId?: string | null
  displayName: string
  adminProfileId: string
}

type MapStatRow = {
  match_id: string
  profile_id: string | null
  team_id: string | null
  player_name: string | null
  agents: string | null
  games: number | null
  games_won: number | null
  games_lost: number | null
  rounds: number | null
  rounds_won: number | null
  rounds_lost: number | null
  acs: number | null
  kd: number | null
  kast_pct: number | null
  adr: number | null
  kills: number | null
  deaths: number | null
  assists: number | null
  fk: number | null
  fd: number | null
  hs_pct: number | null
  econ_rating: number | null
  plants: number | null
  defuses: number | null
  mk_2k: number | null
  mk_3k: number | null
  mk_4k: number | null
  mk_5k: number | null
  clutches_won: number | null
  clutches_attempted: number | null
}

export type GenerateResult = {
  batchId: string
  playerCount: number
  matchCount: number
}

/** Rate stats are averaged by rounds played; counts are added. */
function weightedByRounds(rows: MapStatRow[], key: keyof MapStatRow): number | null {
  let weight = 0
  let total = 0
  for (const row of rows) {
    const w = Number(row.rounds ?? 0)
    const v = row[key] as number | null
    if (!w || v == null) continue
    weight += w
    total += v * w
  }
  return weight > 0 ? total / weight : null
}

export async function generateStatsBatchFromMatches(
  options: GenerateOptions
): Promise<GenerateResult> {
  const { seasonId, displayName, adminProfileId } = options

  // Only matches whose maps carry advanced stats — that is what marks a Riot
  // import apart from a CSV one.
  let matchQuery = supabaseAdmin.from('matches').select('id').eq('approval_status', 'approved')
  if (seasonId) matchQuery = matchQuery.eq('season_id', seasonId)

  const { data: matches, error: matchError } = await matchQuery
  if (matchError) throw new Error(`Failed to load matches: ${matchError.message}`)

  const matchIds = (matches ?? []).map((m) => m.id as string)
  if (matchIds.length === 0) {
    throw new Error('No approved matches found for that season.')
  }

  const { data: mapStats, error: statsError } = await supabaseAdmin
    .from('player_match_map_stats')
    .select(
      'match_id, profile_id, team_id, player_name, agents, games, games_won, games_lost, rounds, rounds_won, rounds_lost, acs, kd, kast_pct, adr, kills, deaths, assists, fk, fd, hs_pct, econ_rating, plants, defuses, mk_2k, mk_3k, mk_4k, mk_5k, clutches_won, clutches_attempted'
    )
    .in('match_id', matchIds)
    .not('clutches_attempted', 'is', null)

  if (statsError) throw new Error(`Failed to load map stats: ${statsError.message}`)

  const rows = (mapStats ?? []) as MapStatRow[]
  if (rows.length === 0) {
    throw new Error(
      'No matches with advanced stats found. Import a match from tracker links first.'
    )
  }

  // Group by profile when claimed, and by name otherwise — the same identity
  // rule the rest of the stats pipeline uses.
  const grouped = new Map<string, MapStatRow[]>()
  for (const row of rows) {
    const key =
      row.profile_id ??
      `name:${String(row.player_name ?? '')
        .trim()
        .toLowerCase()}`
    if (!key || key === 'name:') continue
    const list = grouped.get(key) ?? []
    list.push(row)
    grouped.set(key, list)
  }

  const batchId = crypto.randomUUID()
  const now = new Date().toISOString()

  const statRows = Array.from(grouped.values()).map((entries) => {
    const first = entries[0]
    const kills = sum(entries.map((e) => e.kills))
    const deaths = sum(entries.map((e) => e.deaths))

    /** Null when no map recorded it, so the column reads as "not counted". */
    const addAdvanced = (key: keyof MapStatRow) => {
      const present = entries.map((e) => e[key] as number | null).filter((v) => v !== null)
      return present.length > 0 ? present.reduce((a, b) => a + b, 0) : null
    }

    const games = sum(entries.map((e) => e.games))
    const rounds = sum(entries.map((e) => e.rounds))
    const assists = sum(entries.map((e) => e.assists))
    const fk = sum(entries.map((e) => e.fk))
    const fd = sum(entries.map((e) => e.fd))
    const plants = sum(entries.map((e) => e.plants))
    const defuses = sum(entries.map((e) => e.defuses))

    /** The table stores per-game and per-round rates alongside the totals. */
    const perGame = (total: number) => (games > 0 ? total / games : 0)
    const perRound = (total: number) => (rounds > 0 ? total / rounds : 0)

    return {
      import_batch_id: batchId,
      imported_by_profile_id: adminProfileId,
      imported_at: now,
      profile_id: first.profile_id,
      player_name: first.player_name,
      agents: Array.from(
        new Set(
          entries
            .flatMap((e) => String(e.agents ?? '').split(/\s+/))
            .map((v) => v.trim())
            .filter(Boolean)
        )
      ).join(' '),
      games,
      games_won: sum(entries.map((e) => e.games_won)),
      games_lost: sum(entries.map((e) => e.games_lost)),
      rounds,
      rounds_won: sum(entries.map((e) => e.rounds_won)),
      rounds_lost: sum(entries.map((e) => e.rounds_lost)),
      acs: weightedByRounds(entries, 'acs'),
      // Recomputed from totals rather than averaged — the honest K/D.
      kd: deaths > 0 ? kills / deaths : kills,
      kast_pct: weightedByRounds(entries, 'kast_pct'),
      adr: weightedByRounds(entries, 'adr'),
      kills,
      kpg: perGame(kills),
      kpr: perRound(kills),
      deaths,
      dpg: perGame(deaths),
      dpr: perRound(deaths),
      assists,
      apg: perGame(assists),
      apr: perRound(assists),
      fk,
      fkpg: perGame(fk),
      fd,
      fdpg: perGame(fd),
      hs_pct: weightedByRounds(entries, 'hs_pct'),
      econ_rating: average(entries.map((e) => e.econ_rating)),
      plants,
      plants_per_game: perGame(plants),
      defuses,
      defuses_per_game: perGame(defuses),
      mk_2k: addAdvanced('mk_2k'),
      mk_3k: addAdvanced('mk_3k'),
      mk_4k: addAdvanced('mk_4k'),
      mk_5k: addAdvanced('mk_5k'),
      clutches_won: addAdvanced('clutches_won'),
      clutches_attempted: addAdvanced('clutches_attempted'),
    }
  })

  const includedMatchIds = Array.from(new Set(rows.map((r) => r.match_id)))

  const { error: batchError } = await supabaseAdmin.from('stat_import_batches').insert({
    id: batchId,
    uploaded_by_profile_id: adminProfileId,
    season_id: seasonId ?? null,
    source_filename: 'generated-from-matches',
    display_name: displayName,
    import_kind: 'aggregate',
    status: 'applied',
    dry_run: false,
    row_count: statRows.length,
    accepted_count: statRows.length,
    rejected_count: 0,
    approved_by_profile_id: adminProfileId,
    approved_at: now,
    metadata: {
      import_type: 'rivals_group_stats',
      display_name: displayName,
      // Marks the batch as regenerable — re-running rebuilds it from these.
      generated_from_matches: true,
      source_match_ids: includedMatchIds,
    },
  })

  if (batchError) throw new Error(`Failed to create batch: ${batchError.message}`)

  const { error: insertError } = await supabaseAdmin.from('rivals_group_stats').insert(statRows)
  if (insertError) throw new Error(`Failed to insert stat rows: ${insertError.message}`)

  return { batchId, playerCount: statRows.length, matchCount: includedMatchIds.length }
}
