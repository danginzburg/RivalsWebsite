// One-off: snap existing match times to the nearest quarter hour.
//
// Riot/Henrik imports stored the second the first map loaded (19:07:43) as the
// match time. New imports now round via roundStartTime(); this brings existing
// rows in line. Rows already on a quarter hour (manual entries, CSV midnights)
// are untouched. Imports set ended_at to the same instant as scheduled_at, so
// ended_at is rounded only when it equals the old scheduled_at — a real end
// time from a live-run match is left alone.
//
// Runs a dry-run by default; pass --apply to write. A JSON backup of the old
// values is always saved first for rollback.
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { supabaseAdmin } from './lib/db'
import { roundStartTime } from '../src/lib/server/riot/round-start-time'

const TIME_ZONE = 'America/Chicago'
const APPLY = process.argv.includes('--apply')

type Row = { id: string; scheduled_at: string; ended_at: string | null }
type Change = {
  id: string
  old: { scheduled_at: string; ended_at: string | null }
  next: { scheduled_at: string; ended_at?: string }
}

async function main() {
  const { data, error } = await supabaseAdmin
    .from('matches')
    .select('id, scheduled_at, ended_at')
    .not('scheduled_at', 'is', null)
    .order('scheduled_at', { ascending: true })

  if (error) throw error
  const rows = (data ?? []) as Row[]

  const changes: Change[] = []
  for (const r of rows) {
    const nextScheduled = roundStartTime(r.scheduled_at)!
    if (new Date(nextScheduled).getTime() === new Date(r.scheduled_at).getTime()) continue

    const endedMatches =
      r.ended_at != null && new Date(r.ended_at).getTime() === new Date(r.scheduled_at).getTime()
    changes.push({
      id: r.id,
      old: { scheduled_at: r.scheduled_at, ended_at: r.ended_at },
      next: { scheduled_at: nextScheduled, ...(endedMatches ? { ended_at: nextScheduled } : {}) },
    })
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('en-US', {
      timeZone: TIME_ZONE,
      dateStyle: 'short',
      timeStyle: 'medium',
    })

  console.log(`Rows examined:  ${rows.length}`)
  console.log(`To update:      ${changes.length}\n`)
  for (const c of changes) {
    console.log(
      `${c.id.slice(0, 8)}  Central ${fmt(c.old.scheduled_at)} -> ${fmt(c.next.scheduled_at)}` +
        (c.next.ended_at ? '  (+ended_at)' : '')
    )
  }

  const backupDir = path.join(process.cwd(), 'scripts', 'backups')
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(backupDir, `round-scheduled-at-${stamp}.json`)
  writeFileSync(backupPath, JSON.stringify(changes, null, 2))
  console.log(`\nBackup written: ${backupPath}`)

  if (!APPLY) {
    console.log('\nDRY RUN — no rows written. Re-run with --apply to commit.')
    return
  }

  console.log('\nApplying...')
  let done = 0
  for (const c of changes) {
    const { error: upErr } = await supabaseAdmin.from('matches').update(c.next).eq('id', c.id)
    if (upErr) throw new Error(`Failed to update ${c.id}: ${upErr.message}`)
    done++
  }
  console.log(`Updated ${done} rows.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
