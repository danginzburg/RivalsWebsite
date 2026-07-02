import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildSeries } from './lib/series'
import { DATA_DIR, OUT_DIR, readJson, readTeamAliases } from './lib/cli'
import type { Wb1Parsed } from './lib/parse-wb1'

async function main() {
  const wb1File = path.join(OUT_DIR, 'wb1.json')
  const teamsFile = path.join(DATA_DIR, 'aliases.teams.json')
  if (!existsSync(wb1File)) throw new Error('Run npm run sheets:fetch first (missing wb1.json)')

  const wb1 = readJson<Wb1Parsed>(wb1File)
  const teamAliases = readTeamAliases(teamsFile)

  const { series, mismatches, skippedForfeits, skippedNonRegularSeason } = buildSeries(
    wb1.teamTabs,
    teamAliases
  )

  writeFileSync(path.join(OUT_DIR, 'series.json'), JSON.stringify(series, null, 2))

  console.log(`Built ${series.length} unique regular-season series.`)
  console.log(`Skipped forfeit rows (FFW/FFL): ${skippedForfeits.length}`)
  console.log(`Skipped non-regular-season rows: ${skippedNonRegularSeason.length}`)
  console.log(`Mismatches/orphans: ${mismatches.length}`)
  for (const m of mismatches) {
    console.log(`  - [${m.key}] ${m.reason}`)
  }

  console.log(`Wrote ${path.join(OUT_DIR, 'series.json')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
