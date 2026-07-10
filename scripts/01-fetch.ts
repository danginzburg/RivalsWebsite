import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadWorkbook } from './lib/sheets'
import { parseWb1 } from './lib/parse-wb1'
import { parseWb2 } from './lib/parse-wb2'

const WB1_ID = '1wrrOYoaf8lt845sviKEGrVOLOb0XGus5x3iFxRr6gbQ'
const WB2_ID = '18ZkHBoDDIUOVI1M8Exmew0l7ZHCuGUThYutcmmcxEwA'

const OUT_DIR = path.join(process.cwd(), 'scripts', 'out')

async function main() {
  const fresh = process.argv.includes('--fresh')

  mkdirSync(OUT_DIR, { recursive: true })

  console.log(`Fetching workbook 1 (matches + leaderboard)${fresh ? ' [fresh]' : ''}...`)
  const wb1 = await loadWorkbook(WB1_ID, { fresh })
  const parsedWb1 = parseWb1(wb1)
  writeFileSync(path.join(OUT_DIR, 'wb1.json'), JSON.stringify(parsedWb1, null, 2))

  const teamTabCount = Object.keys(parsedWb1.teamTabs).length
  const rowCount = Object.values(parsedWb1.teamTabs).reduce((t, rows) => t + rows.length, 0)
  console.log(
    `wb1: leaderboard rows=${parsedWb1.leaderboard.length}, team tabs=${teamTabCount}, total match rows=${rowCount}`
  )

  console.log(`Fetching workbook 2 (player stats)${fresh ? ' [fresh]' : ''}...`)
  const wb2 = await loadWorkbook(WB2_ID, { fresh })
  const parsedWb2 = parseWb2(wb2)
  writeFileSync(path.join(OUT_DIR, 'wb2.json'), JSON.stringify(parsedWb2, null, 2))

  const unparsedFooters = parsedWb2.mapTabs.filter((t) => !t.footer.parsed).length
  console.log(
    `wb2: stats rows=${parsedWb2.stats.length}, roster rows=${parsedWb2.roster.length}, map tabs=${parsedWb2.mapTabs.length} (${unparsedFooters} without a readable footer)`
  )

  console.log(`Wrote ${path.join(OUT_DIR, 'wb1.json')} and ${path.join(OUT_DIR, 'wb2.json')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
