import type { SignupAltCheck } from '$lib/signups/alt-check'
import { computeSignupValue } from './index'
import type { RankTarget } from './rank-account'
import { meetsGamesMinimum, type AccountGames, type GamesAccount } from '$lib/signups/comp-games'

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
 * 5. A row with nothing to fetch still has its score refreshed, so a rating
 *    that arrived after the ranks reaches the stored value without a lookup.
 * 6. V26 games are counted whether or not the ranks need filling. A player
 *    under the minimum is counted again on every run, because they may have
 *    played since; one who has reached it never drops back.
 * 7. A row with alts and no alt check is looked up even when its ranks are
 *    filled, so the check is never skipped; the filled ranks are still kept.
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
  computed_value: number | null
  /** PUUID linked to the player's account; preferred over the Riot ID. */
  puuid: string | null
  /** The player's imported rating, used only to recompute the score. */
  rating: number | null
  /** Stored V26 game count; null until first checked. */
  v26_comp_games: number | null
  /** The accounts to count V26 games on. */
  accounts: GamesAccount[]
  /** The player's other accounts, compared with the main. */
  alts: RankTarget[]
  alt_check: SignupAltCheck | null
}

export type SignupPatch = {
  current_rank: string | null
  peak_rank: string | null
  computed_value: number | null
  alt_check?: SignupAltCheck
}

export type RiotResult = {
  currentRank: string | null
  peakRank: string | null
  altCheck?: SignupAltCheck | null
}

export type BulkImportDeps = {
  /**
   * Must not start a request after `deadline` (epoch ms); it throws an error
   * with `status: 429` instead, as it does when rate limited.
   */
  lookupRiot(
    target: RankTarget & { alts: RankTarget[] },
    opts: { deadline: number }
  ): Promise<RiotResult | null>
  /** Count and store a row's V26 games. Same `deadline` contract as `lookupRiot`. */
  checkGames(row: BulkSignupRow, opts: { deadline: number }): Promise<AccountGames>
  save(signupId: string, patch: SignupPatch): Promise<void>
  now(): number
}

export type BulkImportOptions = {
  /** Replace values that are already set instead of only filling blanks. */
  overwrite?: boolean
  timeBudgetMs?: number
  /** Called as each row starts and finishes, so the admin page can show progress live. */
  onProgress?: (event: BulkImportProgressEvent) => void
}

export type BulkImportOutcome = 'updated' | 'skipped' | 'failed'

export type BulkImportRow = {
  id: string
  name: string
  outcome: BulkImportOutcome
  detail: string
}

export type BulkImportProgressEvent =
  | { type: 'start'; index: number; name: string }
  | { type: 'row'; index: number; row: BulkImportRow }

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

function altPatch(altCheck: SignupAltCheck | null | undefined) {
  return altCheck ? { alt_check: altCheck } : {}
}

function altNote(altCheck: SignupAltCheck | null | undefined): string {
  return altCheck?.higherAlt ? ` · Alt higher: ${altCheck.higherAlt}` : ''
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
  const { overwrite = false, onProgress } = options
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
  /** What the games check on the current row found, added to its report line. */
  let gamesNote: { detail: string; changed: boolean; failed: boolean } | null = null

  const nameFor = (row: BulkSignupRow) => riotIdFor(row) ?? row.display_name ?? 'Unknown'

  const record = (row: BulkSignupRow, rankOutcome: BulkImportOutcome, rankDetail: string) => {
    let outcome = rankOutcome
    if (outcome === 'skipped' && gamesNote?.failed) outcome = 'failed'
    else if (outcome === 'skipped' && gamesNote?.changed) outcome = 'updated'
    const detail = gamesNote ? `${rankDetail} ${gamesNote.detail}` : rankDetail
    const line = { id: row.id, name: nameFor(row), outcome, detail }
    report.rows.push(line)
    onProgress?.({ type: 'row', index: report.processed, row: line })
    report[outcome === 'updated' ? 'updated' : outcome === 'failed' ? 'failed' : 'skipped'] += 1
    report.processed += 1
  }

  /** Save the row's score if its ranks and rating now give a different one. */
  const refreshScore = async (
    row: BulkSignupRow,
    skipDetail: string,
    altCheck?: SignupAltCheck | null
  ) => {
    const computedValue = computeSignupValue(row)
    const stored = row.computed_value == null ? null : Number(row.computed_value)
    if (computedValue === stored && !altCheck) {
      record(row, 'skipped', skipDetail)
      return
    }

    try {
      await deps.save(row.id, {
        current_rank: row.current_rank,
        peak_rank: row.peak_rank,
        computed_value: computedValue,
        ...altPatch(altCheck),
      })
      const change =
        computedValue === stored
          ? 'Alts checked'
          : `Score ${stored ?? 'unset'} → ${computedValue ?? 'unset'}`
      record(row, 'updated', `${change}${altNote(altCheck)}`)
    } catch (err) {
      record(row, 'failed', `Save failed: ${errorMessage(err)}`)
    }
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

    gamesNote = null
    onProgress?.({ type: 'start', index, name: nameFor(row) })
    const riotId = riotIdFor(row)
    if (!riotId && !row.puuid) {
      record(row, 'skipped', 'No linked Riot account or tagline.')
      continue
    }

    if (row.accounts.length > 0 && !meetsGamesMinimum(row.v26_comp_games)) {
      try {
        networkCalls += 1
        const { games } = await deps.checkGames(row, { deadline })
        gamesNote = {
          detail: `V26 games: ${games}.`,
          changed: games !== row.v26_comp_games,
          failed: false,
        }
      } catch (err) {
        const wait = rateLimitWait(err)
        if (wait !== undefined) {
          report.stoppedEarly = true
          report.remaining = rows.length - index
          report.retryAfterMs = wait
          break
        }
        // The ranks can still be filled; the flag just stays as it was.
        gamesNote = {
          detail: `V26 games: ${errorMessage(err)}`,
          changed: false,
          failed: true,
        }
      }
    }

    const altsUnchecked = row.alts.length > 0 && !row.alt_check
    if (!overwrite && row.current_rank != null && row.peak_rank != null && !altsUnchecked) {
      await refreshScore(row, 'Already filled.')
      continue
    }

    let riot: RiotResult | null
    try {
      networkCalls += 1
      riot = await deps.lookupRiot({ riotId, puuid: row.puuid, alts: row.alts }, { deadline })
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
      await refreshScore(row, 'Nothing to fill — no competitive rank since V26 Act 1.')
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
      await refreshScore(row, 'Nothing to fill.', riot.altCheck)
      continue
    }

    try {
      await deps.save(row.id, {
        ...patch,
        computed_value: computeSignupValue({ ...patch, rating: row.rating }),
        ...altPatch(riot.altCheck),
      })
    } catch (err) {
      record(row, 'failed', `Save failed: ${errorMessage(err)}`)
      continue
    }

    const filled: string[] = []
    if (patch.current_rank !== row.current_rank) filled.push(`C ${patch.current_rank}`)
    if (patch.peak_rank !== row.peak_rank) filled.push(`P ${patch.peak_rank}`)
    record(row, 'updated', `${filled.join(', ')}${altNote(riot.altCheck)}`)
  }

  return report
}
