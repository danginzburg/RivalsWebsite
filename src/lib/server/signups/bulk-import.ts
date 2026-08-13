import { computeSignupValue } from './index'

/**
 * Bulk fill of signup ranks and tracker scores from the Riot and tracker.gg
 * lookups, run from a single admin button press.
 *
 * Three things shape this design:
 *
 * 1. Both services are third-party and tracker.gg actively discourages
 *    automation, so requests are paced and the batch is capped.
 * 2. A run can outlive a request timeout, so it works to a time budget and
 *    reports how far it got. Because rows that already have values are skipped,
 *    pressing the button again simply continues.
 * 3. It never touches `manual_value_override` — a hand-set value is the
 *    admin's decision and outranks anything fetched.
 */

export type BulkImportSource = 'riot' | 'tracker' | 'both'

/** Pacing between players. Tracker costs several requests per player. */
export const RIOT_DELAY_MS = 150
export const TRACKER_DELAY_MS = 750

/** Upper bound on a single run, regardless of how many rows match. */
export const MAX_BULK_ROWS = 60

/** Leave room for the response to be written before the platform timeout. */
export const DEFAULT_TIME_BUDGET_MS = 50_000

export type BulkSignupRow = {
  id: string
  display_name: string | null
  riot_tag: string | null
  current_rank: string | null
  peak_rank: string | null
  tracker_current_score: number | null
  tracker_peak_score: number | null
}

export type SignupPatch = {
  current_rank: string | null
  peak_rank: string | null
  tracker_current_score: number | null
  tracker_peak_score: number | null
  computed_value: number | null
}

export type RiotResult = {
  currentRank: string | null
  peakRank: string | null
  /** Riot season UUID of the peak act, used to target the tracker reading. */
  peakSeasonId: string | null
}

export type TrackerResult = {
  currentScore: number | null
  peakScore: number | null
}

export type BulkImportDeps = {
  lookupRiot(riotId: string): Promise<RiotResult | null>
  lookupTracker(riotId: string, peakActId: string | null): Promise<TrackerResult>
  save(signupId: string, patch: SignupPatch): Promise<void>
  delay(ms: number): Promise<void>
  now(): number
}

export type BulkImportOptions = {
  source: BulkImportSource
  /** Replace values that are already set instead of only filling blanks. */
  overwrite?: boolean
  timeBudgetMs?: number
}

export type BulkImportOutcome = 'updated' | 'skipped' | 'failed'

export type BulkImportRow = {
  id: string
  name: string
  outcome: BulkImportOutcome
  detail: string
}

export type BulkImportReport = {
  processed: number
  updated: number
  skipped: number
  failed: number
  /** True when the time budget ran out before every row was attempted. */
  stoppedEarly: boolean
  remaining: number
  rows: BulkImportRow[]
}

function riotIdFor(row: BulkSignupRow): string | null {
  const name = row.display_name?.trim()
  const tag = row.riot_tag?.trim()
  if (!name || !tag) return null
  return `${name}#${tag}`
}

function wantsRiot(source: BulkImportSource) {
  return source === 'riot' || source === 'both'
}

function wantsTracker(source: BulkImportSource) {
  return source === 'tracker' || source === 'both'
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Lookup failed'
}

export async function runBulkImport(
  rows: BulkSignupRow[],
  deps: BulkImportDeps,
  options: BulkImportOptions
): Promise<BulkImportReport> {
  const { source, overwrite = false } = options
  const budgetMs = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS
  const startedAt = deps.now()
  const delayMs = wantsTracker(source) ? TRACKER_DELAY_MS : RIOT_DELAY_MS

  const report: BulkImportReport = {
    processed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    stoppedEarly: false,
    remaining: 0,
    rows: [],
  }

  const record = (row: BulkSignupRow, outcome: BulkImportOutcome, detail: string) => {
    report.rows.push({
      id: row.id,
      name: riotIdFor(row) ?? row.display_name ?? 'Unknown',
      outcome,
      detail,
    })
    report[outcome === 'updated' ? 'updated' : outcome === 'failed' ? 'failed' : 'skipped'] += 1
    report.processed += 1
  }

  let networkCalls = 0

  for (const [index, row] of rows.entries()) {
    // Check the budget before starting work, not after — a row half-done is
    // worse than a row not started.
    if (networkCalls > 0 && deps.now() - startedAt >= budgetMs) {
      report.stoppedEarly = true
      report.remaining = rows.length - index
      break
    }

    const riotId = riotIdFor(row)
    if (!riotId) {
      record(row, 'skipped', 'No Riot tagline on this signup.')
      continue
    }

    const needsRanks =
      wantsRiot(source) && (overwrite || row.current_rank == null || row.peak_rank == null)
    const needsScores =
      wantsTracker(source) &&
      (overwrite || row.tracker_current_score == null || row.tracker_peak_score == null)

    if (!needsRanks && !needsScores) {
      record(row, 'skipped', 'Already filled.')
      continue
    }

    // Pace only between rows that actually hit the network.
    if (networkCalls > 0) await deps.delay(delayMs)

    let riot: RiotResult | null = null
    let tracker: TrackerResult | null = null
    const notes: string[] = []

    // The Riot lookup runs whenever tracker scores are wanted too, because the
    // peak act it reports is what makes the peak score the right one.
    if (needsRanks || needsScores) {
      try {
        networkCalls += 1
        riot = await deps.lookupRiot(riotId)
        if (!riot && needsRanks) notes.push('no competitive rank on record')
      } catch (err) {
        if (needsRanks) {
          record(row, 'failed', `Riot: ${errorMessage(err)}`)
          continue
        }
        notes.push(`Riot lookup failed (${errorMessage(err)}), peak act unknown`)
      }
    }

    if (needsScores) {
      try {
        networkCalls += 1
        tracker = await deps.lookupTracker(riotId, riot?.peakSeasonId ?? null)
      } catch (err) {
        // A tracker failure is only fatal when there is nothing else to save.
        if (!riot?.currentRank && !riot?.peakRank) {
          record(row, 'failed', `Tracker: ${errorMessage(err)}`)
          continue
        }
        notes.push(`tracker lookup failed (${errorMessage(err)})`)
      }
    }

    const keep = <T>(existing: T, fetched: T | null | undefined): T => {
      if (fetched == null) return existing
      if (!overwrite && existing != null) return existing
      return fetched as T
    }

    const patch: Omit<SignupPatch, 'computed_value'> = {
      current_rank: needsRanks ? keep(row.current_rank, riot?.currentRank) : row.current_rank,
      peak_rank: needsRanks ? keep(row.peak_rank, riot?.peakRank) : row.peak_rank,
      tracker_current_score: needsScores
        ? keep(row.tracker_current_score, tracker?.currentScore)
        : row.tracker_current_score,
      tracker_peak_score: needsScores
        ? keep(row.tracker_peak_score, tracker?.peakScore)
        : row.tracker_peak_score,
    }

    const unchanged =
      patch.current_rank === row.current_rank &&
      patch.peak_rank === row.peak_rank &&
      patch.tracker_current_score === row.tracker_current_score &&
      patch.tracker_peak_score === row.tracker_peak_score

    if (unchanged) {
      record(
        row,
        'skipped',
        notes.length > 0 ? `Nothing to fill — ${notes.join('; ')}.` : 'Nothing to fill.'
      )
      continue
    }

    try {
      await deps.save(row.id, { ...patch, computed_value: computeSignupValue(patch) })
    } catch (err) {
      record(row, 'failed', `Save failed: ${errorMessage(err)}`)
      continue
    }

    const filled: string[] = []
    if (patch.current_rank !== row.current_rank) filled.push(`C ${patch.current_rank}`)
    if (patch.peak_rank !== row.peak_rank) filled.push(`P ${patch.peak_rank}`)
    if (patch.tracker_current_score !== row.tracker_current_score) {
      filled.push(`Tc ${patch.tracker_current_score}`)
    }
    if (patch.tracker_peak_score !== row.tracker_peak_score) {
      filled.push(`Tp ${patch.tracker_peak_score}`)
    }

    record(row, 'updated', filled.join(', ') + (notes.length > 0 ? ` (${notes.join('; ')})` : ''))
  }

  return report
}
