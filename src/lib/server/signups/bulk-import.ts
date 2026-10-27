import { computeSignupValue } from './index'

/**
 * Bulk fill of signup ranks from the HenrikDev Riot lookup, run from a single
 * admin button press.
 *
 * Three things shape this design:
 *
 * 1. The lookup is a third-party service limited to 30 requests a minute, so a
 *    few hundred players take several minutes. Pacing is the HenrikDev
 *    client's job (it is shared with every other lookup); this runner only
 *    hands it a deadline.
 * 2. A run outlives a request timeout, so each call works to a time budget and
 *    reports how many rows it got through. The admin page calls again from
 *    that cursor until the list is done.
 * 3. Being rate limited is a pause, not a failure: the row is left for the next
 *    call, along with how long to wait before making it.
 * 4. It never touches `manual_value_override` — a hand-set value is the
 *    admin's decision and outranks anything fetched.
 */

/** Safety cap on the rows one run walks; well above a season's signups. */
export const MAX_BULK_ROWS = 1000

/**
 * Leave room for the response to be written before the platform timeout: a
 * lookup can still be in flight (10s timeout) when the budget runs out.
 */
export const DEFAULT_TIME_BUDGET_MS = 40_000

export type BulkSignupRow = {
  id: string
  display_name: string | null
  riot_tag: string | null
  current_rank: string | null
  peak_rank: string | null
  /** PUUID linked to the player's account; preferred over the Riot ID. */
  puuid: string | null
  /** The player's imported rating, used only to recompute the score. */
  rating: number | null
}

export type SignupPatch = {
  current_rank: string | null
  peak_rank: string | null
  computed_value: number | null
}

export type RiotResult = {
  currentRank: string | null
  peakRank: string | null
}

export type BulkImportDeps = {
  /**
   * Must not start a request after `deadline` (epoch ms); it throws an error
   * with `status: 429` instead, as it does when rate limited.
   */
  lookupRiot(
    target: { riotId: string | null; puuid: string | null },
    opts: { deadline: number }
  ): Promise<RiotResult | null>
  save(signupId: string, patch: SignupPatch): Promise<void>
  now(): number
}

export type BulkImportOptions = {
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
  /** True when the time budget or rate limit stopped the run before every row. */
  stoppedEarly: boolean
  remaining: number
  /** Set when a rate limit stopped the run: wait this long before continuing. */
  retryAfterMs: number | null
  rows: BulkImportRow[]
}

function riotIdFor(row: BulkSignupRow): string | null {
  const name = row.display_name?.trim()
  const tag = row.riot_tag?.trim()
  if (!name || !tag) return null
  return `${name}#${tag}`
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Lookup failed'
}

function rateLimitWait(err: unknown): number | null | undefined {
  if (typeof err !== 'object' || err === null) return undefined
  const { status, retryAfterMs } = err as { status?: unknown; retryAfterMs?: unknown }
  if (status !== 429) return undefined
  return typeof retryAfterMs === 'number' && retryAfterMs > 0 ? retryAfterMs : null
}

export async function runBulkImport(
  rows: BulkSignupRow[],
  deps: BulkImportDeps,
  options: BulkImportOptions = {}
): Promise<BulkImportReport> {
  const { overwrite = false } = options
  const budgetMs = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS
  const startedAt = deps.now()

  const report: BulkImportReport = {
    processed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    stoppedEarly: false,
    remaining: 0,
    retryAfterMs: null,
    rows: [],
  }
  const deadline = startedAt + budgetMs

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
    if (!riotId && !row.puuid) {
      record(row, 'skipped', 'No linked Riot account or tagline.')
      continue
    }

    if (!overwrite && row.current_rank != null && row.peak_rank != null) {
      record(row, 'skipped', 'Already filled.')
      continue
    }

    let riot: RiotResult | null
    try {
      networkCalls += 1
      riot = await deps.lookupRiot({ riotId, puuid: row.puuid }, { deadline })
    } catch (err) {
      const wait = rateLimitWait(err)
      if (wait !== undefined) {
        // Leave this row for the next call rather than marking it failed.
        report.stoppedEarly = true
        report.remaining = rows.length - index
        report.retryAfterMs = wait
        break
      }
      record(row, 'failed', `Riot: ${errorMessage(err)}`)
      continue
    }

    if (!riot) {
      record(row, 'skipped', 'Nothing to fill — no competitive rank since V26 Act 1.')
      continue
    }

    const keep = <T>(existing: T, fetched: T | null | undefined): T => {
      if (fetched == null) return existing
      if (!overwrite && existing != null) return existing
      return fetched as T
    }

    const patch = {
      current_rank: keep(row.current_rank, riot.currentRank),
      peak_rank: keep(row.peak_rank, riot.peakRank),
    }

    if (patch.current_rank === row.current_rank && patch.peak_rank === row.peak_rank) {
      record(row, 'skipped', 'Nothing to fill.')
      continue
    }

    try {
      await deps.save(row.id, {
        ...patch,
        computed_value: computeSignupValue({ ...patch, rating: row.rating }),
      })
    } catch (err) {
      record(row, 'failed', `Save failed: ${errorMessage(err)}`)
      continue
    }

    const filled: string[] = []
    if (patch.current_rank !== row.current_rank) filled.push(`C ${patch.current_rank}`)
    if (patch.peak_rank !== row.peak_rank) filled.push(`P ${patch.peak_rank}`)
    record(row, 'updated', filled.join(', '))
  }

  return report
}
