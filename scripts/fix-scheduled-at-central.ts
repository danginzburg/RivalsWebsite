// One-off correction for the scheduled_at timezone bug.
//
// The old admin form sent a bare <input type="datetime-local"> string to the
// server, which parsed it with new Date() in the server's zone (UTC). So an
// admin's typed Central wall-clock digits were stored verbatim as UTC. The raw
// UTC digits of scheduled_at therefore ARE the intended US Central wall-clock;
// we reinterpret them in America/Chicago (auto-handling CDT vs CST per date)
// and re-store the correct absolute UTC instant.
//
// Scope: every match with a manual wall-clock time. We skip the clear imports:
//   - 00:00:00 UTC rows  -> CSV imports (M/D/YYYY -> midnight), no real time
//   - non-zero seconds   -> Riot/Henrik auto-imports (real, already-correct UTC)
//
// Runs a dry-run by default; pass --apply to write. A JSON backup of the old
// values is always saved first for rollback.
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { supabaseAdmin } from './lib/db'

const TIME_ZONE = 'America/Chicago'
const APPLY = process.argv.includes('--apply')

/** Offset (localWallClock-as-UTC minus actual UTC) of `timeZone` at an instant. */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const map: Record<string, string> = {}
  for (const p of dtf.formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') map[p.type] = p.value
  }
  let hour = Number(map.hour)
  if (hour === 24) hour = 0
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second)
  )
  return asUtc - utcMs
}

/** Interpret Y/M/D/H/M as a wall-clock in `timeZone`; return the UTC instant. */
function zonedWallClockToUtcISO(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  timeZone: string
): string {
  const guessMs = Date.UTC(y, mo - 1, d, h, mi, 0, 0)
  const off1 = tzOffsetMs(guessMs, timeZone)
  let utcMs = guessMs - off1
  const off2 = tzOffsetMs(utcMs, timeZone)
  if (off2 !== off1) utcMs = guessMs - off2 // DST boundary correction
  return new Date(utcMs).toISOString()
}

type Row = { id: string; scheduled_at: string | null }

async function main() {
  const { data, error } = await supabaseAdmin
    .from('matches')
    .select('id, scheduled_at')
    .not('scheduled_at', 'is', null)
    .order('scheduled_at', { ascending: true })

  if (error) throw error
  const rows = (data ?? []) as Row[]

  const changes: { id: string; old: string; next: string }[] = []
  const skipped: { id: string; old: string; reason: string }[] = []

  for (const r of rows) {
    const old = r.scheduled_at as string
    const d = new Date(old)
    const h = d.getUTCHours()
    const mi = d.getUTCMinutes()
    const s = d.getUTCSeconds()
    const ms = d.getUTCMilliseconds()

    if (s !== 0 || ms !== 0) {
      skipped.push({ id: r.id, old, reason: 'non-zero seconds (Riot/auto import, real UTC)' })
      continue
    }
    if (h === 0 && mi === 0) {
      skipped.push({ id: r.id, old, reason: 'midnight UTC (CSV date-only import)' })
      continue
    }

    const next = zonedWallClockToUtcISO(
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      d.getUTCDate(),
      h,
      mi,
      TIME_ZONE
    )
    if (next !== old) changes.push({ id: r.id, old, next })
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('en-US', {
      timeZone: TIME_ZONE,
      dateStyle: 'short',
      timeStyle: 'short',
    })

  console.log(`Rows examined:  ${rows.length}`)
  console.log(`To update:      ${changes.length}`)
  console.log(`Skipped:        ${skipped.length}\n`)
  for (const c of changes) {
    console.log(
      `${c.id.slice(0, 8)}  ${c.old} -> ${c.next}   (Central ${fmt(c.old)} -> ${fmt(c.next)})`
    )
  }
  console.log('\nSkipped reasons:')
  const reasons = new Map<string, number>()
  for (const sk of skipped) reasons.set(sk.reason, (reasons.get(sk.reason) ?? 0) + 1)
  for (const [reason, count] of reasons) console.log(`  ${count}  ${reason}`)

  // Always write a rollback backup of the rows we intend to change.
  const backupDir = path.join(process.cwd(), 'scripts', 'backups')
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(backupDir, `scheduled-at-fix-${stamp}.json`)
  writeFileSync(backupPath, JSON.stringify(changes, null, 2))
  console.log(`\nBackup written: ${backupPath}`)

  if (!APPLY) {
    console.log('\nDRY RUN — no rows written. Re-run with --apply to commit.')
    return
  }

  console.log('\nApplying...')
  let done = 0
  for (const c of changes) {
    const { error: upErr } = await supabaseAdmin
      .from('matches')
      .update({ scheduled_at: c.next })
      .eq('id', c.id)
    if (upErr) throw new Error(`Failed to update ${c.id}: ${upErr.message}`)
    done++
  }
  console.log(`Updated ${done} rows.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
