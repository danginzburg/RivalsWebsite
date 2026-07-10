// One-off backup helper: dumps every public table via the REST API into a
// timestamped JSON snapshot, so a migration can be rolled back by re-inserting.
// Direct Postgres access (pg_dump) isn't available in this environment, so we
// go through Supabase's PostgREST endpoint instead.
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { supabaseAdmin } from './lib/db'

const TABLES = [
  'accolades',
  'accolade_assignments',
  'admin_actions',
  'leaderboard_entries',
  'leaderboard_live',
  'match_maps',
  'match_proposals',
  'match_streams',
  'matches',
  'pickem_submissions',
  'player_match_map_stats',
  'player_match_stats',
  'player_registration',
  'profiles',
  'rivals_group_stats',
  'scrim_listings',
  'scrim_slot_claims',
  'scrim_slots',
  'seasons',
  'stat_import_batches',
  'stat_import_errors',
  'team_invites',
  'team_memberships',
  'teams',
]

const PAGE_SIZE = 1000

async function dumpTable(table: string): Promise<unknown[]> {
  const rows: unknown[] = []
  let from = 0
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select('*')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return rows
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.join('scripts', 'backups', stamp)
  mkdirSync(dir, { recursive: true })

  const manifest: Record<string, number> = {}
  for (const table of TABLES) {
    const rows = await dumpTable(table)
    writeFileSync(path.join(dir, `${table}.json`), JSON.stringify(rows, null, 2))
    manifest[table] = rows.length
    console.log(`${table}: ${rows.length} rows`)
  }
  writeFileSync(
    path.join(dir, '_manifest.json'),
    JSON.stringify({ stamp, tables: manifest }, null, 2)
  )
  console.log(`\nBackup written to ${dir}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
