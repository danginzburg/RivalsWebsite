/**
 * Fill signup ranks and tracker.gg scores from this machine, writing straight
 * to Supabase.
 *
 * Why this exists as a script rather than the admin button
 * -------------------------------------------------------
 * api.tracker.gg sits behind Cloudflare bot management, which challenges the
 * requests that miss its cache and have to reach tracker's origin. A cold act
 * — exactly what a peak-score reading asks for — is the likeliest to be
 * refused, and it fails intermittently even from a residential connection.
 * `getJson` retries a block, which clears most of it.
 *
 * What running locally buys is not immunity, it is patience: no serverless
 * timeout to work inside, so the run can pace itself and be repeated until
 * every row is filled. Results are written to the database, so the deployed
 * admin UI just shows the filled values afterwards.
 *
 * The lookup logic is not duplicated here: `runBulkImport` is the same function
 * the admin route calls, with the same third-party clients injected. The only
 * differences are the ones that stop making sense off a serverless host — no
 * auth, no rate limit, no 60-row cap, and no time budget.
 *
 *   npm run signups:fill-tracker -- --dry-run
 *   npm run signups:fill-tracker -- --source tracker --status pending
 *   npm run signups:fill-tracker -- --active-season --overwrite
 */

import { supabaseAdmin } from './lib/db'
import { argValue } from './lib/cli'
import { lookupPlayer, parseRiotId } from '../src/lib/server/riot/henrik'
import { isTrackerAvailable, lookupTrackerScore } from '../src/lib/server/tracker/client'
import {
  runBulkImport,
  type BulkImportSource,
  type BulkSignupRow,
  type SignupPatch,
} from '../src/lib/server/signups/bulk-import'

const SIGNUP_COLUMNS =
  'id, display_name, riot_tag, current_rank, peak_rank, tracker_current_score, tracker_peak_score'

const SOURCES: BulkImportSource[] = ['riot', 'tracker', 'both']

/** Long enough that the budget never fires — the serverless timeout it guards against is not in play here. */
const NO_TIME_BUDGET_MS = 24 * 60 * 60_000

function hasFlag(flag: string) {
  return process.argv.includes(flag)
}

function parseSource(): BulkImportSource {
  const raw = (argValue('--source') ?? 'both').trim()
  if (!SOURCES.includes(raw as BulkImportSource)) {
    throw new Error(`--source must be one of ${SOURCES.join(', ')}`)
  }
  return raw as BulkImportSource
}

async function resolveSeasonFilter(): Promise<{ label: string; seasonId: string | null } | null> {
  if (hasFlag('--active-season')) {
    const { data } = await supabaseAdmin
      .from('seasons')
      .select('id, name')
      .eq('is_active', true)
      .maybeSingle()
    if (!data) throw new Error('No active season found, so --active-season cannot be resolved.')
    return { label: data.name, seasonId: data.id }
  }

  const season = argValue('--season')
  if (!season) return null
  // Matches the admin route's sentinel for "signups with no season set".
  if (season === '__none__') return { label: 'no season set', seasonId: null }
  return { label: season, seasonId: season }
}

async function main() {
  const source = parseSource()
  const status = (argValue('--status') ?? 'pending').trim()
  const overwrite = hasFlag('--overwrite')
  const dryRun = hasFlag('--dry-run')
  const limit = Number(argValue('--limit') ?? '') || null
  const seasonFilter = await resolveSeasonFilter()

  // Fail loudly and early rather than recording a failure against every row.
  if (source !== 'riot' && !(await isTrackerAvailable())) {
    throw new Error('The curl binary is not on PATH, and the tracker lookup shells out to it.')
  }

  let query = supabaseAdmin
    .from('player_signups')
    .select(SIGNUP_COLUMNS)
    .not('riot_tag', 'is', null)
    .order('created_at', { ascending: true })

  if (status !== 'all') query = query.eq('status', status)
  if (seasonFilter) {
    query = seasonFilter.seasonId
      ? query.eq('season_id', seasonFilter.seasonId)
      : query.is('season_id', null)
  }
  if (limit) query = query.limit(limit)

  const { data, error } = await query
  if (error) throw new Error(`Failed to load signups: ${error.message}`)

  const rows = (data ?? []) as BulkSignupRow[]

  console.log(
    [
      `source=${source}`,
      `status=${status}`,
      `season=${seasonFilter?.label ?? 'any'}`,
      `overwrite=${overwrite}`,
      dryRun ? 'DRY RUN — nothing will be written' : 'writing to Supabase',
    ].join('  ')
  )
  console.log(`${rows.length} signup${rows.length === 1 ? '' : 's'} to consider\n`)

  if (rows.length === 0) return

  const wouldWrite: Array<{ id: string; patch: SignupPatch }> = []

  const report = await runBulkImport(
    rows,
    {
      async lookupRiot(riotId) {
        const { rank } = await lookupPlayer(riotId)
        if (!rank) return null
        return {
          currentRank: rank.currentRank,
          peakRank: rank.peakRank,
          peakSeasonId: rank.peakSeasonId,
        }
      },

      async lookupTracker(riotId, peakActId) {
        // Validate the shape here so a malformed tag fails as a tracker error
        // rather than throwing out of the pacing loop.
        parseRiotId(riotId)
        const result = await lookupTrackerScore(riotId, { peakActId })
        return {
          currentScore: result.current?.score ?? null,
          peakScore: result.peak?.score ?? null,
        }
      },

      async save(signupId: string, patch: SignupPatch) {
        if (dryRun) {
          wouldWrite.push({ id: signupId, patch })
          return
        }
        const { error: updateError } = await supabaseAdmin
          .from('player_signups')
          .update(patch)
          .eq('id', signupId)
        if (updateError) throw new Error(updateError.message)
      },

      delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
    },
    { source, overwrite, timeBudgetMs: NO_TIME_BUDGET_MS }
  )

  const mark = { updated: dryRun ? 'would fill' : 'filled', skipped: 'skipped', failed: 'FAILED' }
  for (const row of report.rows) {
    console.log(`  ${mark[row.outcome].padEnd(10)} ${row.name.padEnd(28)} ${row.detail}`)
  }

  console.log(
    `\n${dryRun ? 'Would fill' : 'Filled'} ${report.updated}, skipped ${report.skipped}, failed ${report.failed} of ${report.processed} processed.`
  )

  if (dryRun && wouldWrite.length > 0) {
    console.log('\nPatches that would be written:')
    for (const { id, patch } of wouldWrite) {
      console.log(`  ${id}  ${JSON.stringify(patch)}`)
    }
  }

  // Tracker blocks are transient, so a partly-blocked run is normal and the
  // fix is simply to run it again — filled rows are skipped next time.
  const blocked = report.rows.filter((r) => /refused|block/i.test(r.detail))
  if (blocked.length > 0) {
    console.log(
      `\ntracker.gg refused ${blocked.length} of ${report.processed} rows even after retries.\n` +
        'That is expected on cold acts — run this again to pick them up.'
    )
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
