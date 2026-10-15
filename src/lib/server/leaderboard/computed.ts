import { supabaseAdmin } from '$lib/supabase/admin'
import { COMPUTED_SOURCE } from '$lib/server/leaderboard/batch'
import { publicDataCache } from '$lib/server/cache'
import { invalidateStandingsRanks } from '$lib/server/leaderboard/ranks'
import { resolveMatchStage } from '$lib/server/stats/from-matches'
import {
  computeStandings,
  countsTowardStandings,
  type ComputedStandingsRow,
  type StandingsAdjustment,
  type StandingsMatch,
} from '$lib/server/leaderboard/compute'

/**
 * Standings calculated from imported matches, materialized as a regular
 * leaderboard batch.
 *
 * Every standings reader (the leaderboard, event pages, team pages, match
 * ranks) takes the season's newest applied `leaderboard_entries` batch. Writing
 * the calculation into one long-lived batch per season — refilled in place and
 * bumped to newest on each refresh — means they only had to learn to prefer it
 * (see `pickStandingsBatch`). A CSV import is the fallback: it shows only for a
 * season with no calculated standings or no matches to calculate from.
 */

export { COMPUTED_SOURCE }

type TeamRow = { id: string; name: string }

type MatchRow = {
  id: string
  stage: string | null
  metadata: Record<string, unknown> | null
  team_a_id: string
  team_b_id: string
  team_a_score: number | null
  team_b_score: number | null
  winner_team_id: string | null
  match_maps: StandingsMatch['maps'] | null
}

export type SeasonStandings = {
  seasonId: string
  rows: Array<ComputedStandingsRow & { team_name: string; team_tag: string | null }>
  /** Matches that fed the table (regular season and unfiled). */
  matchCount: number
  /** External tournaments award points; Rivals seasons do not. */
  awardPoints: boolean
  /** Left out of the ranking. */
  disbandedTeams: Array<{ id: string; name: string }>
  batch: { id: string; refreshed_at: string } | null
}

/** Postgres "undefined table" / PostgREST "table not in schema cache". */
function isMissingTable(err: { code?: string } | null): boolean {
  return err?.code === '42P01' || err?.code === 'PGRST205'
}

async function findComputedBatch(seasonId: string) {
  const { data, error } = await supabaseAdmin
    .from('stat_import_batches')
    .select('id, created_at')
    .eq('season_id', seasonId)
    .filter('metadata->>import_type', 'eq', 'leaderboard_entries')
    .filter('metadata->>source', 'eq', COMPUTED_SOURCE)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Failed to load computed standings batch: ${error.message}`)
  return (data as { id: string; created_at: string } | null) ?? null
}

/** The calculation for one season, without writing anything. */
export async function calculateSeasonStandings(seasonId: string): Promise<SeasonStandings> {
  const [seasonRes, teamsRes, matchesRes, adjRes, batch] = await Promise.all([
    supabaseAdmin.from('seasons').select('kind').eq('id', seasonId).maybeSingle(),
    supabaseAdmin
      .from('teams')
      .select('id, name, tag, status')
      .eq('season_id', seasonId)
      .eq('approval_status', 'approved'),
    supabaseAdmin
      .from('matches')
      .select(
        'id, stage, metadata, team_a_id, team_b_id, team_a_score, team_b_score, winner_team_id, match_maps (team_a_rounds, team_b_rounds, is_voided)'
      )
      .eq('season_id', seasonId)
      .eq('status', 'completed')
      .eq('approval_status', 'approved'),
    supabaseAdmin
      .from('leaderboard_adjustments')
      .select(
        'team_id, wins, losses, map_wins, map_losses, round_diff, points, rank_override, note'
      )
      .eq('season_id', seasonId),
    findComputedBatch(seasonId),
  ])

  if (teamsRes.error) throw new Error(`Failed to load teams: ${teamsRes.error.message}`)
  if (matchesRes.error) throw new Error(`Failed to load matches: ${matchesRes.error.message}`)
  // Before the adjustments migration is applied there is simply nothing to
  // correct; the calculation itself does not depend on it.
  if (adjRes.error && !isMissingTable(adjRes.error)) {
    throw new Error(`Failed to load adjustments: ${adjRes.error.message}`)
  }

  const allTeams = (teamsRes.data ?? []) as Array<
    TeamRow & { tag: string | null; status: string | null }
  >
  const teams = allTeams.filter((t) => t.status !== 'disbanded')
  const awardPoints = seasonRes.data?.kind === 'external'
  const matches: StandingsMatch[] = ((matchesRes.data ?? []) as MatchRow[]).map((m) => ({
    id: m.id,
    // Designation-only matches ("Week 3") count as regular season, the same
    // reading the stat batch generator uses.
    stage: resolveMatchStage({ stage: m.stage, metadata: m.metadata } as never),
    team_a_id: m.team_a_id,
    team_b_id: m.team_b_id,
    team_a_score: m.team_a_score,
    team_b_score: m.team_b_score,
    winner_team_id: m.winner_team_id,
    maps: m.match_maps ?? [],
  }))

  const byId = new Map(teams.map((t) => [t.id, t]))
  const adjustments = (adjRes.error ? [] : (adjRes.data ?? [])) as StandingsAdjustment[]
  const rows = computeStandings(teams, matches, adjustments, { awardPoints }).map((row) => ({
    ...row,
    team_name: byId.get(row.team_id)?.name ?? 'Unknown team',
    team_tag: byId.get(row.team_id)?.tag ?? null,
  }))

  return {
    seasonId,
    rows,
    matchCount: matches.filter((m) => countsTowardStandings(m.stage)).length,
    awardPoints,
    disbandedTeams: allTeams
      .filter((t) => t.status === 'disbanded')
      .map((t) => ({ id: t.id, name: t.name })),
    batch: batch ? { id: batch.id, refreshed_at: batch.created_at } : null,
  }
}

/**
 * Recalculate a season and publish it as the season's current standings.
 *
 * `actorProfileId` is recorded on the batch when this is the season's first
 * calculation (the column is NOT NULL); later refreshes keep the original.
 */
export async function publishSeasonStandings(
  seasonId: string,
  actorProfileId: string
): Promise<SeasonStandings> {
  const standings = await calculateSeasonStandings(seasonId)
  const now = new Date().toISOString()
  const today = now.slice(0, 10)

  const { data: season } = await supabaseAdmin
    .from('seasons')
    .select('name')
    .eq('id', seasonId)
    .maybeSingle()

  const metadata = {
    import_type: 'leaderboard_entries',
    source: COMPUTED_SOURCE,
    display_name: 'Standings',
    split: 'computed',
    as_of_date: today,
    season_name: (season?.name as string | undefined) ?? null,
    match_count: standings.matchCount,
    award_points: standings.awardPoints,
  }

  let batchId = standings.batch?.id ?? null
  if (batchId) {
    // created_at is what "newest batch" means to every reader, so a refresh
    // moves it forward to put the calculation back in front of a CSV import.
    const { error } = await supabaseAdmin
      .from('stat_import_batches')
      .update({
        created_at: now,
        approved_at: now,
        row_count: standings.rows.length,
        accepted_count: standings.rows.length,
        metadata,
      })
      .eq('id', batchId)
    if (error) throw new Error(`Failed to update standings batch: ${error.message}`)
  } else {
    batchId = crypto.randomUUID()
    const { error } = await supabaseAdmin.from('stat_import_batches').insert({
      id: batchId,
      uploaded_by_profile_id: actorProfileId,
      season_id: seasonId,
      source_filename: 'computed-from-matches',
      display_name: 'Standings',
      import_kind: 'aggregate',
      week_label: null,
      status: 'applied',
      dry_run: false,
      row_count: standings.rows.length,
      accepted_count: standings.rows.length,
      rejected_count: 0,
      approved_by_profile_id: actorProfileId,
      approved_at: now,
      created_at: now,
      metadata,
    })
    if (error) throw new Error(`Failed to create standings batch: ${error.message}`)
  }

  const { error: deleteError } = await supabaseAdmin
    .from('leaderboard_entries')
    .delete()
    .eq('import_batch_id', batchId)
  if (deleteError) throw new Error(`Failed to clear standings rows: ${deleteError.message}`)

  if (standings.rows.length > 0) {
    // `split` keeps these rows out of the (season, split, as_of_date, team)
    // unique slot a same-day CSV import would use.
    const { error: insertError } = await supabaseAdmin.from('leaderboard_entries').insert(
      standings.rows.map((row) => ({
        season_id: seasonId,
        split: 'computed',
        as_of_date: today,
        team_id: row.team_id,
        matches_played: row.matches_played,
        wins: row.wins,
        losses: row.losses,
        map_wins: row.map_wins,
        map_losses: row.map_losses,
        round_wins: row.round_wins,
        round_losses: row.round_losses,
        round_diff: row.round_diff,
        points: row.points,
        tiebreaker_score: row.round_diff,
        rank: row.rank,
        import_batch_id: batchId,
        metadata: {
          source: COMPUTED_SOURCE,
          auto: row.auto,
          adjusted: Boolean(row.adjustment),
        },
      }))
    )
    if (insertError) throw new Error(`Failed to write standings rows: ${insertError.message}`)
  }

  publicDataCache.delete('leaderboard:standings')
  invalidateStandingsRanks(seasonId)

  return { ...standings, batch: { id: batchId, refreshed_at: now } }
}

/**
 * Refresh after a match result changed. Best-effort, like the stat batch
 * refresh beside it: the match is already saved, and the admin standings page
 * has a Recalculate button.
 *
 * Only the active season, or a season already on calculated standings, is
 * touched — editing an old match must not bury a past season's imported final
 * table under a calculated one.
 */
export async function refreshStandingsForSeason(
  seasonId: string | null | undefined,
  actorProfileId: string
): Promise<void> {
  if (!seasonId) return
  try {
    const [{ data: season }, existing] = await Promise.all([
      supabaseAdmin.from('seasons').select('is_active').eq('id', seasonId).maybeSingle(),
      findComputedBatch(seasonId),
    ])
    if (!season?.is_active && !existing) return
    await publishSeasonStandings(seasonId, actorProfileId)
  } catch (err) {
    console.error('Failed to refresh standings:', err)
  }
}

export async function refreshStandingsForMatch(
  matchId: string,
  actorProfileId: string
): Promise<void> {
  const { data: match } = await supabaseAdmin
    .from('matches')
    .select('season_id')
    .eq('id', matchId)
    .maybeSingle()
  await refreshStandingsForSeason(match?.season_id as string | null | undefined, actorProfileId)
}
