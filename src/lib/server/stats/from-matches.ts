import { supabaseAdmin } from '$lib/supabase/admin'
import { average, sum } from '$lib/server/math'
import { inferMatchStageFromLabel, normalizeSectionKey, type SectionKey } from '$lib/stats/sections'

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
 * Sections are how a season gets split up. A generated batch is scoped by
 * season plus `matches.stage`, so "Season 5 Kickoff" is one call with
 * `stages: ['kickoff']`.
 *
 * Live batches
 * ------------
 * The scope is stored on the batch, not the list of matches it happened to
 * find. That is what makes a batch created *before* the event work: "Season 5
 * Kickoff" can be set up empty, and every match import afterwards re-runs the
 * same season+stage query and refills it — see `refreshLiveBatchesForMatch`.
 * The batch id never changes, so links and curated season lists keep working.
 *
 * Only maps that actually carry advanced stats are included. A CSV-imported map
 * has NULL multikills, and averaging those in would quietly understate whoever
 * played in both. It also means hand-entered historical matches cannot leak
 * into a generated batch and duplicate a CSV import of the same event.
 */

export type GenerateOptions = {
  /** Restrict to one season. Omitted means every imported match. */
  seasonId?: string | null
  /**
   * Restrict to matches in these stages. Empty or omitted means every stage,
   * including matches that have never been filed under one.
   */
  stages?: SectionKey[] | null
  /** Where the batch lands in the stats picker. Defaults to the single stage. */
  section?: SectionKey | null
  displayName: string
  sortOrder?: number | null
  /**
   * Rebuild this batch automatically whenever a match in its scope is
   * imported. Live batches may sit empty until the first match arrives.
   */
  autoRefresh?: boolean
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

type MatchRow = {
  id: string
  stage: string | null
  metadata: Record<string, unknown> | null
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

/**
 * The stage a match counts as, for filtering.
 *
 * `matches.stage` is the answer when an admin has set one. Otherwise the free
 * text designation ("Grand Finals", "Week 3") is read, so a season's history
 * can be split into sections without editing every match by hand first.
 */
export function resolveMatchStage(match: MatchRow): SectionKey | null {
  const explicit = normalizeSectionKey(match.stage)
  if (explicit) return explicit
  return inferMatchStageFromLabel((match.metadata ?? {})?.designation)
}

/**
 * Which of these matches carry advanced stats — i.e. came from a tracker
 * import rather than a hand-entered CSV.
 *
 * The generator only ever aggregates these, so counting anything else would
 * promise matches the batch will not actually contain.
 */
async function filterToAdvancedStatMatches(matchIds: string[]): Promise<Set<string>> {
  if (matchIds.length === 0) return new Set()

  const { data, error } = await supabaseAdmin
    .from('player_match_map_stats')
    .select('match_id')
    .in('match_id', matchIds)
    .not('clutches_attempted', 'is', null)

  if (error) throw new Error(`Failed to check advanced stats: ${error.message}`)
  return new Set((data ?? []).map((r) => r.match_id as string))
}

/**
 * Match ids in scope, plus how many matches sit in each stage.
 *
 * Counts are of matches the generator can actually use (advanced stats
 * present), which is why a season full of backfilled CSV matches reports zero.
 */
export async function selectMatchesForStages(options: {
  seasonId?: string | null
  stages?: SectionKey[] | null
}): Promise<{ matchIds: string[]; countsByStage: Record<string, number> }> {
  let query = supabaseAdmin
    .from('matches')
    .select('id, stage, metadata')
    .eq('approval_status', 'approved')
  if (options.seasonId) query = query.eq('season_id', options.seasonId)

  const { data, error } = await query
  if (error) throw new Error(`Failed to load matches: ${error.message}`)

  const rows = (data ?? []) as MatchRow[]
  const usable = await filterToAdvancedStatMatches(rows.map((r) => r.id))

  const wanted = new Set(options.stages ?? [])
  const matchIds: string[] = []
  const countsByStage: Record<string, number> = {}

  for (const row of rows) {
    if (!usable.has(row.id)) continue
    const stage = resolveMatchStage(row)
    const bucket = stage ?? 'unfiled'
    countsByStage[bucket] = (countsByStage[bucket] ?? 0) + 1
    if (wanted.size > 0 && (stage === null || !wanted.has(stage))) continue
    matchIds.push(row.id)
  }

  return { matchIds, countsByStage }
}

/**
 * Per-player aggregate rows for a set of matches, ready to insert.
 *
 * `allowEmpty` is what lets a live batch be created ahead of its event: with no
 * matches yet there is nothing to aggregate, and that is a valid state rather
 * than an error.
 */
async function buildStatRows(
  matchIds: string[],
  batchId: string,
  adminProfileId: string,
  allowEmpty = false
) {
  const now = new Date().toISOString()
  if (matchIds.length === 0) {
    if (!allowEmpty) throw new Error('No matches in scope.')
    return { statRows: [], includedMatchIds: [], now }
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
    if (!allowEmpty) {
      throw new Error(
        'No matches with advanced stats found for that scope. Import a match from tracker links first.'
      )
    }
    return { statRows: [], includedMatchIds: [], now }
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

  return { statRows, includedMatchIds: Array.from(new Set(rows.map((r) => r.match_id))), now }
}

export async function generateStatsBatchFromMatches(
  options: GenerateOptions
): Promise<GenerateResult> {
  const { seasonId, displayName, adminProfileId } = options
  const stages = (options.stages ?? []).filter(Boolean)
  // One stage in, one section out — the common case needs no extra field.
  const section = options.section ?? (stages.length === 1 ? stages[0] : null)
  const autoRefresh = options.autoRefresh ?? false

  const { matchIds } = await selectMatchesForStages({ seasonId, stages })
  // A one-off snapshot of nothing is a mistake worth reporting. A live batch
  // being empty on day one is the whole point of setting it up early.
  if (matchIds.length === 0 && !autoRefresh) {
    throw new Error(
      stages.length > 0
        ? 'No imported matches are filed under those stages yet.'
        : 'No imported matches found for that season yet.'
    )
  }

  const batchId = crypto.randomUUID()
  const { statRows, includedMatchIds, now } = await buildStatRows(
    matchIds,
    batchId,
    adminProfileId,
    autoRefresh
  )

  const { error: batchError } = await supabaseAdmin.from('stat_import_batches').insert({
    id: batchId,
    uploaded_by_profile_id: adminProfileId,
    season_id: seasonId ?? null,
    source_filename: 'generated-from-matches',
    display_name: displayName,
    import_kind: 'aggregate',
    section,
    sort_order: options.sortOrder ?? null,
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
      auto_refresh: autoRefresh,
      source_season_id: seasonId ?? null,
      source_stages: stages,
      source_match_ids: includedMatchIds,
    },
  })

  if (batchError) throw new Error(`Failed to create batch: ${batchError.message}`)

  if (statRows.length > 0) {
    const { error: insertError } = await supabaseAdmin.from('rivals_group_stats').insert(statRows)
    if (insertError) throw new Error(`Failed to insert stat rows: ${insertError.message}`)
  }

  return { batchId, playerCount: statRows.length, matchCount: includedMatchIds.length }
}

type GeneratedBatchRow = {
  id: string
  display_name: string | null
  season_id: string | null
  metadata: {
    generated_from_matches?: boolean
    auto_refresh?: boolean
    source_season_id?: string | null
    source_stages?: unknown
  } | null
}

export type BatchScope = {
  seasonId: string | null
  stages: SectionKey[]
  autoRefresh: boolean
}

/** The stored scope of a generated batch, in the shape the selectors want. */
function batchScope(batch: GeneratedBatchRow): BatchScope {
  return {
    seasonId: batch.metadata?.source_season_id ?? batch.season_id ?? null,
    stages: Array.isArray(batch.metadata?.source_stages)
      ? batch.metadata.source_stages
          .map((s) => normalizeSectionKey(s))
          .filter((s): s is SectionKey => s !== null)
      : [],
    autoRefresh: Boolean(batch.metadata?.auto_refresh),
  }
}

/**
 * Whether importing this match should rebuild a batch with this scope.
 *
 * Two deliberate refusals:
 *   - A scope with no season (`seasonId: null`) never matches. That shape means
 *     "every season at once" and is what produces a batch spanning all of
 *     history; it must not grow silently in the background.
 *   - A match with no resolvable stage never matches a stage-filtered scope.
 *     Sweeping unfiled matches into "Season 5 Playoffs" because they happen to
 *     be in the right season would quietly corrupt it.
 */
export function batchCoversMatch(
  scope: Pick<BatchScope, 'seasonId' | 'stages'>,
  match: { seasonId: string | null; stage: SectionKey | null }
): boolean {
  if (!scope.seasonId) return false
  if (scope.seasonId !== match.seasonId) return false
  if (scope.stages.length === 0) return true
  return match.stage !== null && scope.stages.includes(match.stage)
}

/**
 * Rebuild a generated batch in place from its stored scope.
 *
 * This is the point of storing the filter rather than the match id list: a
 * newly imported playoffs match is picked up by re-running the same season and
 * stage query, so "Season 5 Playoffs" stays current without the admin
 * re-entering anything — and without the batch id changing, which would break
 * every link and every curated season list pointing at it.
 *
 * The old rows are deleted before the new ones land. A failure between the two
 * leaves the batch empty rather than doubled, which is the safer of the two:
 * an empty batch is obvious, a doubled one silently inflates every total.
 */
export async function regenerateStatsBatch(options: {
  batchId: string
  adminProfileId: string
}): Promise<GenerateResult> {
  const { batchId, adminProfileId } = options

  const { data: batch, error: batchError } = await supabaseAdmin
    .from('stat_import_batches')
    .select('id, display_name, season_id, metadata')
    .eq('id', batchId)
    .maybeSingle<GeneratedBatchRow>()

  if (batchError) throw new Error(`Failed to load batch: ${batchError.message}`)
  if (!batch) throw new Error('Batch not found.')
  if (!batch.metadata?.generated_from_matches) {
    throw new Error('That batch was uploaded from a CSV, so there is nothing to regenerate from.')
  }

  const { seasonId, stages, autoRefresh } = batchScope(batch)

  const { matchIds } = await selectMatchesForStages({ seasonId, stages })
  // A live batch is defined as whatever is in scope right now, so an empty
  // scope empties it. A one-off snapshot refuses, rather than silently wiping
  // a batch whose matches were re-filed or unapproved.
  if (matchIds.length === 0 && !autoRefresh) {
    throw new Error('No imported matches match this batch’s scope any more.')
  }

  const { statRows, includedMatchIds, now } = await buildStatRows(
    matchIds,
    batchId,
    adminProfileId,
    autoRefresh
  )

  const { error: deleteError } = await supabaseAdmin
    .from('rivals_group_stats')
    .delete()
    .eq('import_batch_id', batchId)
  if (deleteError) throw new Error(`Failed to clear old stat rows: ${deleteError.message}`)

  if (statRows.length > 0) {
    const { error: insertError } = await supabaseAdmin.from('rivals_group_stats').insert(statRows)
    if (insertError) throw new Error(`Failed to insert stat rows: ${insertError.message}`)
  }

  const { error: updateError } = await supabaseAdmin
    .from('stat_import_batches')
    .update({
      row_count: statRows.length,
      accepted_count: statRows.length,
      rejected_count: 0,
      approved_by_profile_id: adminProfileId,
      approved_at: now,
      metadata: {
        ...(batch.metadata ?? {}),
        import_type: 'rivals_group_stats',
        generated_from_matches: true,
        source_season_id: seasonId,
        source_stages: stages,
        source_match_ids: includedMatchIds,
        regenerated_at: now,
      },
    })
    .eq('id', batchId)

  if (updateError) throw new Error(`Failed to update batch: ${updateError.message}`)

  return { batchId, playerCount: statRows.length, matchCount: includedMatchIds.length }
}

/**
 * Rebuild every live batch whose scope covers a just-imported match.
 *
 * This is what makes "Season 5 Kickoff" fill itself in: the batch is created
 * once, before the event, and each import afterwards lands here and re-runs its
 * season+stage query. Nothing to click, and no risk of a stale snapshot sitting
 * on /stats for a week.
 *
 * A batch only qualifies when the match is inside its scope, so importing a
 * Season 5 playoffs match never touches the kickoff batch. Batches scoped to
 * every season (`source_season_id: null`) are deliberately skipped — that is
 * the shape that swallows backfilled history, and it should not be a thing that
 * grows on its own in the background.
 *
 * Callers treat this as best-effort: a failure here must never fail the import
 * that triggered it, since the match data itself is already safely written.
 */
export async function refreshLiveBatchesForMatch(options: {
  matchId: string
  adminProfileId: string
}): Promise<Array<{ batchId: string; displayName: string | null; playerCount: number }>> {
  const { matchId, adminProfileId } = options

  const { data: match, error: matchError } = await supabaseAdmin
    .from('matches')
    .select('id, season_id, stage, metadata')
    .eq('id', matchId)
    .maybeSingle()

  if (matchError) throw new Error(`Failed to load match: ${matchError.message}`)
  if (!match) return []

  const matchStage = resolveMatchStage(match as MatchRow)
  const matchSeasonId = (match.season_id as string | null) ?? null

  const { data: batches, error: batchesError } = await supabaseAdmin
    .from('stat_import_batches')
    .select('id, display_name, season_id, metadata')
    .filter('metadata->>import_type', 'eq', 'rivals_group_stats')
    .filter('metadata->>auto_refresh', 'eq', 'true')
    .limit(100)

  if (batchesError) throw new Error(`Failed to load live batches: ${batchesError.message}`)

  const refreshed: Array<{ batchId: string; displayName: string | null; playerCount: number }> = []

  for (const row of (batches ?? []) as GeneratedBatchRow[]) {
    const scope = batchScope(row)
    if (!batchCoversMatch(scope, { seasonId: matchSeasonId, stage: matchStage })) continue

    const result = await regenerateStatsBatch({ batchId: row.id, adminProfileId })
    refreshed.push({
      batchId: row.id,
      displayName: row.display_name,
      playerCount: result.playerCount,
    })
  }

  return refreshed
}
