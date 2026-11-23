/**
 * Recompute every signup's stored score with the current formula (rank plus
 * the league-performance bonus). Run once after the formula changes.
 *
 *   npx tsx --env-file=.env --tsconfig scripts/tsconfig.json scripts/recalculate-signup-scores.ts [season-code] [--apply]
 *
 * Dry run by default: prints each change and writes nothing. --apply saves
 * `computed_value`. Admin adjustments and manual overrides are left alone; they
 * sit on top of the stored score.
 */
import { supabaseAdmin as db } from './lib/db'
import { computeSignupValue } from '$lib/server/signups'
import { loadPerformanceForPlayers } from '$lib/server/signups/performance'
import { loadPlayerDirectory } from '$lib/server/players/directory'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const seasonCode = args.find((a) => !a.startsWith('--')) ?? 'rivals5'

const { data: season, error: seasonError } = await db
  .from('seasons')
  .select('id, name')
  .eq('code', seasonCode)
  .maybeSingle()
if (seasonError || !season) throw new Error(`No season ${seasonCode}`)

const { data: signups, error } = await db
  .from('player_signups')
  .select('id, profile_id, current_rank, peak_rank, computed_value')
  .eq('season_id', season.id)
if (error) throw new Error(error.message)

const rows = signups ?? []
const [performance, directory] = await Promise.all([
  loadPerformanceForPlayers(rows.map((s) => s.profile_id)),
  loadPlayerDirectory(rows.map((s) => s.profile_id)),
])

let changed = 0
for (const s of rows) {
  const next = computeSignupValue({
    current_rank: s.current_rank,
    peak_rank: s.peak_rank,
    performance: performance.get(s.profile_id) ?? null,
  })
  const prev = s.computed_value == null ? null : Number(s.computed_value)
  if (next === prev) continue
  changed++
  const name = directory.get(s.profile_id)?.riot_name ?? s.profile_id
  console.log(`${name}: ${prev ?? 'unset'} → ${next ?? 'unset'}`)
  if (apply) {
    const { error: saveError } = await db
      .from('player_signups')
      .update({ computed_value: next })
      .eq('id', s.id)
    if (saveError) throw new Error(`Save failed for ${name}: ${saveError.message}`)
  }
}

console.log(
  `${season.name}: ${changed} of ${rows.length} scores ${apply ? 'updated' : 'would change (dry run; pass --apply to save)'}`
)
