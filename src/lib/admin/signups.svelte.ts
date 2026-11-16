import { adminJsonRequest } from '$lib/admin/api'
import type { PlayerSignup, SignupEditState } from '$lib/admin/types'

/*
 * State and actions for the admin Signups tab.
 *
 * Kept on the page (not in the tab component) so it survives switching tabs: a
 * bulk import keeps running and the loaded list stays put while the admin looks
 * at another tab.
 */

type BulkImportReport = {
  processed: number
  updated: number
  skipped: number
  failed: number
  stoppedEarly: boolean
  remaining: number
  retryAfterMs?: number | null
  rows: Array<{ id: string; name: string; outcome: string; detail: string }>
}

type BulkImportRow = BulkImportReport['rows'][number]

type BulkImportChunk = {
  report: BulkImportReport
  total: number
  /** Where the next call should start, or null once the list is done. */
  nextCursor: number | null
}

/** One line of the bulk import's streamed response. */
type BulkImportLine =
  | { type: 'begin'; total: number; cursor: number }
  | { type: 'start'; index: number; name: string }
  | { type: 'row'; index: number; row: BulkImportRow }
  | { type: 'alt'; row: BulkImportRow }
  | ({ type: 'done' } & BulkImportChunk)
  | { type: 'error'; message: string }

/**
 * One call to the bulk import. The server streams a line per row as it goes,
 * handed to `onLine`; resolves with the closing summary.
 */
async function requestBulkImportChunk(
  body: Record<string, unknown>,
  onLine: (line: BulkImportLine) => void
): Promise<BulkImportChunk> {
  const response = await fetch('/api/admin/signups/bulk-import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.message ?? `Bulk import failed (${response.status})`)
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let done: BulkImportChunk | null = null
  for (;;) {
    const { value, done: ended } = await reader.read()
    if (value) buffer += value
    const lines = buffer.split('\n')
    buffer = ended ? '' : (lines.pop() ?? '')
    for (const text of lines) {
      if (!text.trim()) continue
      const line = JSON.parse(text) as BulkImportLine
      if (line.type === 'error') throw new Error(line.message)
      if (line.type === 'done') done = line
      else onLine(line)
    }
    if (ended) break
  }
  // A cut-off stream (platform timeout) never sends its closing line.
  if (!done) throw new Error('Bulk import was cut off. Run it again to continue.')
  return done
}

/** Calls in a row that got through no rows before the run gives up. */
const BULK_IMPORT_MAX_STALLS = 5
/** Longest pause between calls; the API's rate-limit window is a minute. */
const BULK_IMPORT_MAX_PAUSE_MS = 65_000

/** Blank numeric fields are sent as null so the API clears them. */
function signupBody(state: SignupEditState) {
  return {
    displayName: state.displayName || null,
    discordHandle: state.discordHandle || null,
    currentRank: state.currentRank || null,
    peakRank: state.peakRank || null,
  }
}

export type AdminMessages = { error: string | null; success: string | null }

export class SignupsAdmin {
  private ui: AdminMessages
  private refreshPendingCounts: () => Promise<unknown>

  constructor(ui: AdminMessages, refreshPendingCounts: () => Promise<unknown>) {
    this.ui = ui
    this.refreshPendingCounts = refreshPendingCounts
  }

  playerSignups = $state<PlayerSignup[]>([])
  signupsLoaded = $state(false)
  signupStatusFilter = $state('pending')
  signupEditForm = $state<Record<string, SignupEditState>>({})
  processingSignupId = $state<string | null>(null)

  loadSignups = async () => {
    try {
      const result = await adminJsonRequest<{ signups?: PlayerSignup[] }>(
        `/api/admin/signups?status=${encodeURIComponent(this.signupStatusFilter)}`,
        { fallbackMessage: 'Failed to load signups' }
      )
      this.playerSignups = result.signups ?? []
      this.signupsLoaded = true
    } catch (err) {
      this.ui.error = err instanceof Error ? err.message : 'Failed to load signups'
    }
  }

  signupStateFor = (signupId: string): SignupEditState | null => {
    const existing = this.signupEditForm[signupId]
    if (existing) return existing

    const signup = this.playerSignups.find((s) => s.id === signupId)
    if (!signup) return null

    return {
      displayName: signup.display_name ?? '',
      // Falls back to the Discord name the player logged in with.
      discordHandle: signup.discord_handle || signup.profile.discord_username || '',
      currentRank: signup.current_rank ?? '',
      peakRank: signup.peak_rank ?? '',
      manualAdjustment: Number(signup.manual_adjustment ?? 0)
        ? String(signup.manual_adjustment)
        : '',
    }
  }

  updateSignupEditForm = (signupId: string, patch: Partial<SignupEditState>) => {
    const current = this.signupStateFor(signupId)
    if (!current) return
    this.signupEditForm = { ...this.signupEditForm, [signupId]: { ...current, ...patch } }
  }

  riotLookupSignupId = $state<string | null>(null)

  /**
   * Look the player up through HenrikDev: fill current and peak rank (peak since
   * V26 Act 1) and store their V26 game count. Any manual override is left alone.
   */
  fetchRiotRank = async (signupId: string) => {
    const signup = this.playerSignups.find((s) => s.id === signupId)
    if (!signup) return

    // The server prefers the PUUID linked to the player's account and falls
    // back to the name#tag on the signup.
    const name = signup.display_name?.trim()
    const tag = signup.riot_tag?.trim()
    const query =
      `profileId=${encodeURIComponent(signup.profile_id)}` +
      `&signupId=${encodeURIComponent(signupId)}` +
      (name && tag ? `&riotId=${encodeURIComponent(`${name}#${tag}`)}` : '')

    this.riotLookupSignupId = signupId
    this.ui.error = null
    this.ui.success = null
    try {
      // Counted first: a player with no rank to fill still has a game count,
      // and this lookup leaves the rank below already cached.
      const games = await adminJsonRequest<{ games: number; account: string | null }>(
        '/api/admin/signups/comp-games',
        { method: 'POST', body: { id: signupId }, fallbackMessage: 'V26 games lookup failed' }
      )
      this.playerSignups = this.playerSignups.map((s) =>
        s.id === signupId
          ? { ...s, v26_comp_games: games.games, v26_comp_games_account: games.account }
          : s
      )

      const result = await adminJsonRequest<{
        account: { name: string; tag: string }
        altCheck: PlayerSignup['alt_check']
        rank: {
          currentTier: string | null
          currentRank: string | null
          currentSource: 'current' | 'last-act' | null
          currentAct: string | null
          peakTier: string | null
          peakRank: string | null
          peakSeason: string | null
        } | null
      }>(`/api/admin/riot-lookup?${query}`, {
        fallbackMessage: 'Riot lookup failed',
      })

      if (result.altCheck) signup.alt_check = result.altCheck

      if (!result.rank || (!result.rank.currentTier && !result.rank.peakTier)) {
        this.ui.success = `${result.account.name}#${result.account.tag} verified, but has no competitive rank since V26 Act 1.`
        return
      }

      const patch: Partial<SignupEditState> = {}
      if (result.rank.currentRank) patch.currentRank = result.rank.currentRank
      if (result.rank.peakRank) patch.peakRank = result.rank.peakRank

      if (Object.keys(patch).length === 0) {
        this.ui.success = `${result.account.name}#${result.account.tag} verified, but their tier (${result.rank.currentTier ?? 'unknown'}) does not map to a league rank.`
        return
      }

      this.updateSignupEditForm(signupId, patch)
      // Say when the current rank is a fallback rather than the live rank.
      const currentNote =
        result.rank.currentSource === 'last-act'
          ? ` (unrated now, end of ${result.rank.currentAct})`
          : ''
      const peakNote = result.rank.peakSeason ? ` (${result.rank.peakSeason})` : ''
      const check = result.altCheck
      const altNote =
        check && check.usedRiotId !== check.main.riotId
          ? ` Used alt ${check.usedRiotId}: ${
              check.higherAlt === check.usedRiotId
                ? 'it ranks higher than the main'
                : 'the main has under 100 games'
            }.`
          : ''
      this.ui.success = `Filled from Riot: ${result.rank.currentRank ?? '—'} current${currentNote}, ${result.rank.peakRank ?? '—'} peak since V26 A1${peakNote}.${altNote} Save to apply.`
    } catch (err) {
      this.ui.error = err instanceof Error ? err.message : 'Riot lookup failed'
    } finally {
      this.riotLookupSignupId = null
    }
  }

  bulkImportRunning = $state(false)
  bulkImportReport = $state<BulkImportReport | null>(null)
  bulkImportProgress = $state<{
    done: number
    total: number
    /** The player being looked up now. */
    current: string | null
    /** Seconds left in a rate-limit pause. */
    waitSeconds: number | null
  } | null>(null)
  bulkImportStopRequested = false
  wakeBulkImport: (() => void) | null = null

  stopSignupBulkImport = () => {
    this.bulkImportStopRequested = true
    this.wakeBulkImport?.()
  }

  /** A pause that Stop cuts short. */
  bulkImportPause = (ms: number) => {
    const endsAt = Date.now() + ms
    const tick = () => {
      if (this.bulkImportProgress) {
        this.bulkImportProgress.waitSeconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
      }
    }
    tick()
    const countdown = setInterval(tick, 1000)
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms)
      this.wakeBulkImport = () => {
        clearTimeout(timer)
        resolve()
      }
    }).finally(() => {
      clearInterval(countdown)
      this.wakeBulkImport = null
      if (this.bulkImportProgress) this.bulkImportProgress.waitSeconds = null
    })
  }

  /**
   * Fill ranks for the whole filtered list.
   * Each call to the server works to a time budget and the HenrikDev client
   * paces every request under the API's limit, so this keeps calling from the
   * returned cursor — pausing when the server reports a rate limit — until the
   * list is done or the admin stops it.
   */
  runSignupBulkImport = async (overwrite: boolean) => {
    const scope = this.signupStatusFilter === 'all' ? '' : `${this.signupStatusFilter} `
    const warning = overwrite ? '\n\nExisting values will be replaced.' : ''
    if (!window.confirm(`Fetch ranks and V26 games from Riot for the ${scope}signups?${warning}`)) {
      return
    }

    this.bulkImportRunning = true
    this.bulkImportStopRequested = false
    this.bulkImportReport = null
    this.bulkImportProgress = null
    this.ui.error = null
    this.ui.success = null

    const totals: BulkImportReport = {
      processed: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      stoppedEarly: false,
      remaining: 0,
      rows: [],
    }
    let cursor = 0
    let stalls = 0
    /** Outcomes streamed in the current call, until its summary arrives. */
    let liveCounts: Record<string, number> = {}

    try {
      for (;;) {
        const chunkStart = cursor
        const { report, total, nextCursor } = await requestBulkImportChunk(
          { overwrite, status: this.signupStatusFilter, cursor },
          (line) => {
            if (line.type === 'begin') {
              this.bulkImportProgress = {
                done: line.cursor,
                total: line.total,
                current: null,
                waitSeconds: null,
              }
            } else if (line.type === 'start') {
              if (this.bulkImportProgress) this.bulkImportProgress.current = line.name
            } else if (line.type === 'row' || line.type === 'alt') {
              // Counted from the closing summary; shown now.
              totals.rows.push(line.row)
              liveCounts[line.row.outcome] = (liveCounts[line.row.outcome] ?? 0) + 1
              this.bulkImportReport = {
                ...totals,
                updated: totals.updated + (liveCounts.updated ?? 0),
                skipped: totals.skipped + (liveCounts.skipped ?? 0),
                failed: totals.failed + (liveCounts.failed ?? 0),
                rows: [...totals.rows],
              }
              if (this.bulkImportProgress && line.type === 'row') {
                this.bulkImportProgress.done = chunkStart + line.index + 1
              }
            }
          }
        )
        liveCounts = {}

        totals.processed += report.processed
        totals.updated += report.updated
        totals.skipped += report.skipped
        totals.failed += report.failed
        totals.remaining = report.remaining
        totals.stoppedEarly = nextCursor != null
        this.bulkImportReport = { ...totals, rows: [...totals.rows] }
        this.bulkImportProgress = {
          done: nextCursor ?? total,
          total,
          current: null,
          waitSeconds: null,
        }

        if (nextCursor == null) break
        stalls = report.processed === 0 ? stalls + 1 : 0
        if (stalls >= BULK_IMPORT_MAX_STALLS) {
          throw new Error('Riot lookups are still rate limited. Run it again later to continue.')
        }
        if (this.bulkImportStopRequested) break
        if (report.retryAfterMs) {
          await this.bulkImportPause(Math.min(report.retryAfterMs, BULK_IMPORT_MAX_PAUSE_MS))
          if (this.bulkImportStopRequested) break
        }
        cursor = nextCursor
      }

      this.ui.success =
        `Bulk import: ${totals.updated} updated, ${totals.skipped} skipped, ${totals.failed} failed.` +
        (totals.stoppedEarly
          ? ` Stopped with ${totals.remaining} left — run it again to continue.`
          : '')
    } catch (err) {
      this.ui.error = err instanceof Error ? err.message : 'Bulk import failed'
    } finally {
      this.bulkImportRunning = false
      this.bulkImportProgress = null
      // Earlier calls may have saved rows even when a later one failed.
      if (totals.processed > 0) await Promise.all([this.loadSignups(), this.refreshPendingCounts()])
    }
  }

  saveSignup = async (signupId: string, status?: 'pending' | 'approved' | 'rejected') => {
    const state = this.signupStateFor(signupId)
    if (!state) return

    this.processingSignupId = signupId
    this.ui.error = null
    this.ui.success = null
    try {
      await adminJsonRequest('/api/admin/signups', {
        method: 'PATCH',
        body: { id: signupId, ...signupBody(state), ...(status ? { status } : {}) },
        fallbackMessage: 'Failed to update signup',
      })
      if (status === 'pending') this.ui.success = 'Signup moved back to pending.'
      else this.ui.success = status ? `Signup ${status}.` : 'Signup updated.'
      await Promise.all([this.loadSignups(), this.refreshPendingCounts()])
    } catch (err) {
      this.ui.error = err instanceof Error ? err.message : 'Failed to update signup'
    } finally {
      this.processingSignupId = null
    }
  }

  /**
   * Save only the adjustment, leaving any other unsaved edits in the form.
   * `null` removes it.
   */
  setSignupAdjustment = async (signupId: string, adjustment: number | null) => {
    const value = adjustment ?? 0
    if (!Number.isFinite(value)) {
      this.ui.error = 'Enter a number for the adjustment.'
      return
    }

    this.processingSignupId = signupId
    this.ui.error = null
    this.ui.success = null
    try {
      await adminJsonRequest('/api/admin/signups', {
        method: 'PATCH',
        body: { id: signupId, manualAdjustment: value },
        fallbackMessage: 'Failed to update adjustment',
      })
      this.updateSignupEditForm(signupId, { manualAdjustment: value === 0 ? '' : String(value) })
      this.ui.success =
        value === 0
          ? 'Adjustment removed.'
          : `Adjustment of ${value > 0 ? '+' : ''}${value} applied.`
      await this.loadSignups()
    } catch (err) {
      this.ui.error = err instanceof Error ? err.message : 'Failed to update adjustment'
    } finally {
      this.processingSignupId = null
    }
  }

  deleteSignup = async (signupId: string, name: string) => {
    if (!window.confirm(`Delete the signup for ${name}?`)) return

    this.processingSignupId = signupId
    this.ui.error = null
    this.ui.success = null
    try {
      await adminJsonRequest(`/api/admin/signups?id=${encodeURIComponent(signupId)}`, {
        method: 'DELETE',
        fallbackMessage: 'Failed to delete signup',
      })
      this.ui.success = 'Signup deleted.'
      await Promise.all([this.loadSignups(), this.refreshPendingCounts()])
    } catch (err) {
      this.ui.error = err instanceof Error ? err.message : 'Failed to delete signup'
    } finally {
      this.processingSignupId = null
    }
  }
}
