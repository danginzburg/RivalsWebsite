import { error } from '@sveltejs/kit'

import {
  PICKEM_BUCKETS,
  getAllowedPickemBucketsForRecord,
  getMatchupJointOutcomes,
  jointBucketsMatchAMatchup,
  type PickemBucket,
} from '$lib/pickemBuckets'
import { buildPickemMatchupPairsFromRows } from '$lib/pickemFinalRoundMatchups'
import { safeNumber } from '$lib/server/parse'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { supabaseAdmin } from '$lib/supabase/admin'

export const PICKEM_KIND = 'final_buckets' as const

export {
  PICKEM_BUCKETS,
  coerceMatchupBucketAssignments,
  getAllowedPickemBucketsForRecord,
  getMatchupJointOutcomes,
  jointBucketsMatchAMatchup,
  matchupAllowedBucketsForSide,
  partnerBucketAfterPick,
  type PickemBucket,
} from '$lib/pickemBuckets'
export {
  buildPickemMatchupPairsFromRows,
  buildPickemMatchupSideMetaFromRows,
  buildPickemOpponentIdByTeamId,
} from '$lib/pickemFinalRoundMatchups'

export type PickemConfig = {
  enabled: boolean
  leaderboard_batch_id: string | null
  participant_count: number
  baseline_completed_rounds: number
  prediction_round: number
  lock_at: string | null
  status: 'draft' | 'open' | 'locked' | 'scored'
}

export type PickemSourceBatch = {
  id: string
  display_name: string
  source_filename: string | null
  created_at: string
  as_of_date: string | null
  split: string
}

export type PickemTeamRow = {
  leaderboard_entry_id: number
  rank: number
  series_played: number
  wins: number
  losses: number
  round_diff: number
  team: {
    id: string
    name: string
    tag: string | null
    logo_url: string | null
  } | null
}

export type PickemFinalTeamOutcome = PickemTeamRow & {
  final_wins: number
  final_losses: number
  final_round_diff: number
  final_bucket: PickemBucket
}

export type PickemRecordBucket = {
  label: string
  wins: number
  losses: number
}

export type PickemBucketCounts = Record<PickemBucket, number>

export type PickemBucketFeasibilityContext = {
  baselineRows: PickemTeamRow[]
  baselineCompletedRounds: number
  predictionRound: number
}

export type PickemSubmissionPayload = {
  buckets: Record<PickemBucket, string[]>
}

export type PickemSubmissionRecord = {
  id: string
  season_id: string
  profile_id: string
  kind: string
  payload: PickemSubmissionPayload
  score: number
  scored_at: string | null
  created_at: string
  updated_at: string
}

const DEFAULT_CONFIG: PickemConfig = {
  enabled: false,
  leaderboard_batch_id: null,
  participant_count: 24,
  baseline_completed_rounds: 2,
  prediction_round: 3,
  lock_at: null,
  status: 'draft',
}

export function normalizePickemConfig(value: unknown): PickemConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const status =
    typeof raw.status === 'string' && ['draft', 'open', 'locked', 'scored'].includes(raw.status)
      ? (raw.status as PickemConfig['status'])
      : DEFAULT_CONFIG.status

  return {
    enabled: Boolean(raw.enabled),
    leaderboard_batch_id:
      typeof raw.leaderboard_batch_id === 'string' && raw.leaderboard_batch_id.trim().length > 0
        ? raw.leaderboard_batch_id.trim()
        : null,
    participant_count: Number.isInteger(raw.participant_count)
      ? Number(raw.participant_count)
      : DEFAULT_CONFIG.participant_count,
    baseline_completed_rounds: Number.isInteger(raw.baseline_completed_rounds)
      ? Number(raw.baseline_completed_rounds)
      : DEFAULT_CONFIG.baseline_completed_rounds,
    prediction_round: Number.isInteger(raw.prediction_round)
      ? Number(raw.prediction_round)
      : DEFAULT_CONFIG.prediction_round,
    lock_at:
      typeof raw.lock_at === 'string' && raw.lock_at.trim().length > 0 ? raw.lock_at.trim() : null,
    status,
  }
}

export function pickemConfigFromSeasonMetadata(metadata: unknown): PickemConfig {
  const slice =
    metadata !== null && typeof metadata === 'object'
      ? (metadata as Record<string, unknown>).pickem
      : undefined
  return normalizePickemConfig(slice)
}

export function buildEmptyBucketPayload(teamIds: string[] = []): PickemSubmissionPayload {
  const buckets: Record<PickemBucket, string[]> = {
    '3-0': [],
    '2-1': [],
    '1-2': [],
    '0-3': [],
  }

  if (teamIds.length === 0) return { buckets }

  for (const teamId of teamIds) buckets['2-1'].push(teamId)
  return { buckets }
}

export function validateBucketPayload(
  payload: unknown,
  validTeamIds: string[],
  participantCount = 24,
  feasibility?: PickemBucketFeasibilityContext
): PickemSubmissionPayload {
  const source = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const rawBuckets =
    source.buckets && typeof source.buckets === 'object'
      ? (source.buckets as Record<string, unknown>)
      : {}

  const buckets = Object.fromEntries(
    PICKEM_BUCKETS.map((bucket) => [
      bucket,
      Array.isArray(rawBuckets[bucket])
        ? rawBuckets[bucket]
            .map((teamId) => (typeof teamId === 'string' ? teamId.trim() : ''))
            .filter(Boolean)
        : [],
    ])
  ) as Record<PickemBucket, string[]>

  const expectedCounts: PickemBucketCounts = {
    '3-0': 3,
    '2-1': 9,
    '1-2': 9,
    '0-3': 3,
  }

  for (const bucket of PICKEM_BUCKETS) {
    if (buckets[bucket].length !== expectedCounts[bucket]) {
      throw error(400, `Bucket ${bucket} must contain exactly ${expectedCounts[bucket]} teams`)
    }
  }

  const submittedTeamIds = PICKEM_BUCKETS.flatMap((bucket) => buckets[bucket])
  if (submittedTeamIds.length !== participantCount) {
    throw error(400, `Submission must contain exactly ${participantCount} teams`)
  }

  const validSet = new Set(validTeamIds)
  const seen = new Set<string>()
  for (const teamId of submittedTeamIds) {
    if (!validSet.has(teamId))
      throw error(400, 'Submission contains a team outside the pickem field')
    if (seen.has(teamId)) throw error(400, 'Each team must appear exactly once')
    seen.add(teamId)
  }

  if (seen.size !== validTeamIds.length) {
    throw error(400, 'Submission must include every team in the pickem field')
  }

  if (feasibility) {
    const { baselineRows, baselineCompletedRounds, predictionRound } = feasibility
    const rowByTeamId = new Map(
      baselineRows.map((row) => [row.team?.id ?? '', row] as const).filter(([id]) => Boolean(id))
    )

    for (const bucket of PICKEM_BUCKETS) {
      for (const teamId of buckets[bucket]) {
        const row = rowByTeamId.get(teamId)
        if (!row) continue

        const allowed = getAllowedPickemBucketsForRecord(
          row.wins,
          row.losses,
          baselineCompletedRounds,
          predictionRound
        )
        if (!allowed.includes(bucket)) {
          const teamName = row.team?.name?.trim()
          const label = teamName && teamName.length > 0 ? teamName : 'Unknown team'
          throw error(
            400,
            `${label} cannot finish ${bucket} from their current ${row.wins}-${row.losses} record`
          )
        }
      }
    }

    const bucketByTeamId = new Map<string, PickemBucket>()
    for (const bucket of PICKEM_BUCKETS) {
      for (const teamId of buckets[bucket]) {
        bucketByTeamId.set(teamId, bucket)
      }
    }

    for (const [idFirst, idSecond] of buildPickemMatchupPairsFromRows(baselineRows)) {
      const rowF = rowByTeamId.get(idFirst)
      const rowS = rowByTeamId.get(idSecond)
      if (!rowF?.team || !rowS?.team) continue

      const outcomes = getMatchupJointOutcomes(
        rowF.wins,
        rowF.losses,
        rowS.wins,
        rowS.losses,
        baselineCompletedRounds,
        predictionRound
      )
      if (!outcomes.ifFirstWins && !outcomes.ifSecondWins) continue

      const bf = bucketByTeamId.get(idFirst)
      const bs = bucketByTeamId.get(idSecond)
      if (!bf || !bs) continue

      if (!jointBucketsMatchAMatchup(bf, bs, outcomes)) {
        const n1 = rowF.team.name.trim() || 'Team'
        const n2 = rowS.team.name.trim() || 'Team'
        throw error(
          400,
          `Buckets for ${n1} vs ${n2} must match one head-to-head result (one wins, one loses that series).`
        )
      }
    }
  }

  return { buckets }
}

export function isPickemLocked(config: PickemConfig, now = new Date()) {
  if (config.status === 'locked' || config.status === 'scored') return true
  if (!config.lock_at) return false
  const lockAt = new Date(config.lock_at)
  return Number.isFinite(lockAt.getTime()) && lockAt.getTime() <= now.getTime()
}

function normalizeBatch(batch: any): PickemSourceBatch {
  return {
    id: batch.id,
    display_name: batch.metadata?.display_name ?? batch.display_name ?? batch.source_filename,
    source_filename: batch.source_filename ?? null,
    created_at: batch.created_at,
    as_of_date: batch.metadata?.as_of_date ?? null,
    split: batch.metadata?.split ?? 'main',
  }
}

function normalizeTeamRow(entry: any): PickemTeamRow {
  const team = Array.isArray(entry.teams) ? entry.teams[0] : entry.teams
  return {
    leaderboard_entry_id: safeNumber(entry.id),
    rank: safeNumber(entry.rank),
    series_played: safeNumber(entry.matches_played),
    wins: safeNumber(entry.wins),
    losses: safeNumber(entry.losses),
    round_diff: safeNumber(entry.round_diff),
    team: team
      ? {
          id: team.id,
          name: team.name,
          tag: team.tag ?? null,
          logo_url: getTeamLogoUrl(team),
        }
      : null,
  }
}

function parseSubmissionPayload(payload: unknown): PickemSubmissionPayload {
  const source = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const rawBuckets =
    source.buckets && typeof source.buckets === 'object'
      ? (source.buckets as Record<string, unknown>)
      : {}

  return {
    buckets: Object.fromEntries(
      PICKEM_BUCKETS.map((bucket) => [
        bucket,
        Array.isArray(rawBuckets[bucket])
          ? rawBuckets[bucket].filter((teamId): teamId is string => typeof teamId === 'string')
          : [],
      ])
    ) as Record<PickemBucket, string[]>,
  }
}

export async function listLeaderboardBatches(
  limit = 20,
  seasonId?: string
): Promise<PickemSourceBatch[]> {
  let query = supabaseAdmin
    .from('stat_import_batches')
    .select('id, season_id, display_name, source_filename, created_at, metadata')
    .filter('metadata->>import_type', 'eq', 'leaderboard_entries')
    .eq('status', 'applied')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (seasonId) query = query.eq('season_id', seasonId)

  const { data, error: batchError } = await query

  if (batchError) throw error(500, 'Failed to load leaderboard batches')
  return (data ?? []).map(normalizeBatch)
}

export async function getLeaderboardRowsForBatch(batchId: string): Promise<PickemTeamRow[]> {
  const { data, error: entriesError } = await supabaseAdmin
    .from('leaderboard_entries')
    .select(
      `
      id,
      rank,
      matches_played,
      wins,
      losses,
      round_diff,
      teams:teams!leaderboard_entries_team_id_fkey (id, name, tag, logo_path)
    `
    )
    .eq('import_batch_id', batchId)
    .order('rank', { ascending: true, nullsFirst: false })

  if (entriesError) throw error(500, 'Failed to load leaderboard entries')
  return (data ?? []).map(normalizeTeamRow)
}

export async function getPickemBaselineForSeason(seasonId: string) {
  const { data: season, error: seasonError } = await supabaseAdmin
    .from('seasons')
    .select('id, code, name, metadata')
    .eq('id', seasonId)
    .maybeSingle()

  if (seasonError || !season) throw error(404, 'Season not found')

  const config = pickemConfigFromSeasonMetadata(season.metadata)
  const sourceBatch = config.leaderboard_batch_id
    ? ((await listLeaderboardBatches(100, season.id)).find(
        (batch) => batch.id === config.leaderboard_batch_id
      ) ?? null)
    : null

  const rows = config.leaderboard_batch_id
    ? (await getLeaderboardRowsForBatch(config.leaderboard_batch_id)).slice(
        0,
        config.participant_count
      )
    : []

  return {
    season: {
      id: season.id,
      code: season.code,
      name: season.name,
    },
    config,
    sourceBatch,
    rows,
  }
}

export function validatePickemBaseline(
  rows: PickemTeamRow[],
  participantCount = 24,
  baselineCompletedRounds = 2
) {
  if (rows.length !== participantCount) {
    throw error(400, `Selected leaderboard batch must contain exactly ${participantCount} teams`)
  }

  for (const row of rows) {
    if (!row.team?.id)
      throw error(400, 'Selected leaderboard batch contains an entry without a team')
    if (row.series_played !== baselineCompletedRounds) {
      throw error(
        400,
        `Every team in the selected leaderboard batch must have exactly ${baselineCompletedRounds} matches played`
      )
    }
    if (row.wins + row.losses !== baselineCompletedRounds) {
      throw error(
        400,
        `Every team in the selected leaderboard batch must have a ${baselineCompletedRounds}-match record`
      )
    }
  }
}

export function getCurrentRecordBuckets(baselineCompletedRounds: number): PickemRecordBucket[] {
  return Array.from({ length: baselineCompletedRounds + 1 }, (_, losses) => {
    const wins = baselineCompletedRounds - losses
    return {
      label: `${wins}-${losses}`,
      wins,
      losses,
    }
  })
}

export function getCurrentBuckets(rows: PickemTeamRow[], baselineCompletedRounds = 2) {
  return Object.fromEntries(
    getCurrentRecordBuckets(baselineCompletedRounds).map((bucket) => [
      bucket.label,
      rows.filter((row) => row.wins === bucket.wins && row.losses === bucket.losses),
    ])
  )
}

export async function getPickemFinalOutcomesForSeason(
  seasonId: string
): Promise<PickemFinalTeamOutcome[]> {
  const baseline = await getPickemBaselineForSeason(seasonId)
  if (!baseline.config.leaderboard_batch_id) return []

  validatePickemBaseline(
    baseline.rows,
    baseline.config.participant_count,
    baseline.config.baseline_completed_rounds
  )

  const finalBatches = await listLeaderboardBatches(100, seasonId)
  const scoredBatch = finalBatches.find((batch) => {
    if (baseline.sourceBatch?.split && batch.split !== baseline.sourceBatch.split) return false
    if (
      baseline.sourceBatch?.as_of_date &&
      batch.as_of_date &&
      batch.as_of_date <= baseline.sourceBatch.as_of_date
    )
      return false
    return true
  })

  if (!scoredBatch) return []

  const finalRows = await getLeaderboardRowsForBatch(scoredBatch.id)
  const finalByTeamId = new Map(finalRows.map((row) => [row.team?.id ?? '', row]))

  return baseline.rows
    .map((row) => {
      const finalRow = row.team?.id ? finalByTeamId.get(row.team.id) : null
      const finalWins = finalRow?.wins ?? row.wins
      const finalLosses = finalRow?.losses ?? row.losses
      const finalRoundDiff = finalRow?.round_diff ?? row.round_diff
      const finalBucket = `${finalWins}-${finalLosses}` as PickemBucket

      if (!PICKEM_BUCKETS.includes(finalBucket)) return null

      return {
        ...row,
        final_wins: finalWins,
        final_losses: finalLosses,
        final_round_diff: finalRoundDiff,
        final_bucket: finalBucket,
      }
    })
    .filter((row): row is PickemFinalTeamOutcome => Boolean(row))
}

export function scoreBucketSubmission(
  payload: PickemSubmissionPayload,
  finalOutcomes: PickemFinalTeamOutcome[]
) {
  const actualBucketByTeamId = new Map(
    finalOutcomes.map((row) => [row.team?.id ?? '', row.final_bucket])
  )
  let score = 0

  for (const bucket of PICKEM_BUCKETS) {
    for (const teamId of payload.buckets[bucket]) {
      if (actualBucketByTeamId.get(teamId) === bucket) score += 1
    }
  }

  return score
}

export async function getPickemSubmissionForProfile(seasonId: string, profileId: string) {
  const { data, error: submissionError } = await supabaseAdmin
    .from('pickem_submissions')
    .select('id, season_id, profile_id, kind, payload, score, scored_at, created_at, updated_at')
    .eq('season_id', seasonId)
    .eq('profile_id', profileId)
    .eq('kind', PICKEM_KIND)
    .maybeSingle()

  if (submissionError) throw error(500, 'Failed to load pickem submission')
  if (!data) return null

  return {
    ...data,
    payload: parseSubmissionPayload(data.payload),
  } as PickemSubmissionRecord
}

export type PickemSubmissionListEntry = {
  id: string
  submittedAt: string
  user: {
    id: string | null
    name: string
  }
}

/** Stable alphabetical order for the public submissions list (no ranking). */
export function sortPickemSubmissionEntriesByName<T extends PickemSubmissionListEntry>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) =>
    a.user.name.localeCompare(b.user.name, undefined, { sensitivity: 'base' })
  )
}

/** Submitted users for a season (no scores or ranking). Sorted by display name. */
export async function listPickemSubmissionsForSeason(
  seasonId: string
): Promise<PickemSubmissionListEntry[]> {
  const { data, error: listError } = await supabaseAdmin
    .from('pickem_submissions')
    .select('id, created_at, profiles!pickem_submissions_profile_id_fkey (id, display_name, email)')
    .eq('season_id', seasonId)
    .eq('kind', PICKEM_KIND)

  if (listError) throw error(500, 'Failed to load pickem submissions')

  const rows = (data ?? []).map(
    (row: {
      id: string
      created_at: string
      profiles:
        | { id: string | null; display_name: string | null; email: string | null }
        | { id: string | null; display_name: string | null; email: string | null }[]
        | null
    }) => {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
      return {
        id: row.id,
        submittedAt: row.created_at,
        user: {
          id: profile?.id ?? null,
          name: profile?.display_name?.trim() || profile?.email?.trim() || 'User',
        },
      }
    }
  )

  return sortPickemSubmissionEntriesByName(rows)
}
