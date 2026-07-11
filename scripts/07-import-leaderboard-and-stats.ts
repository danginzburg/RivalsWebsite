import { existsSync } from 'node:fs'
import path from 'node:path'
import { supabaseAdmin, resolveAdminUserId, makeAdminEvent } from './lib/db'
import { OUT_DIR, readJson, argValue } from './lib/cli'
import { POST as leaderboardImportPOST } from '../src/routes/api/admin/leaderboard/import/+server'
import { POST as statsImportPOST } from '../src/routes/api/admin/stats/+server'
import type { Wb1Parsed } from './lib/parse-wb1'
import type { Wb2Parsed } from './lib/parse-wb2'
import { pickField as pick, toNumber, toPercent } from './lib/row-fields'

async function importLeaderboard(authSub: string, wb1: Wb1Parsed) {
  const rows = wb1.leaderboard.map((row) => ({
    team: pick(row, ['team']),
    series_played: pick(row, ['series played', 'series_played', '# series']),
    series_wins: pick(row, ['series wins', 'series_wins']),
    series_losses: pick(row, ['series losses', 'series_losses']),
    map_wins: pick(row, ['map wins', 'map_wins']),
    map_losses: pick(row, ['map losses', 'map_losses']),
    maps_played: pick(row, ['maps played', 'maps_played', '# maps']),
    points: pick(row, ['points']),
    round_diff: pick(row, ['round diff', 'round_diff', 'rounddiff']),
  }))

  if (rows.length === 0) {
    console.log('No leaderboard rows found in wb1.json; skipping leaderboard import.')
    return
  }

  const asOfDate = new Date().toISOString().slice(0, 10)
  const payload = {
    rows,
    split: 'main',
    asOfDate,
    sourceFilename: 'google-sheets-leaderboard.xlsx',
    displayName: 'Google Sheets leaderboard import',
  }

  const event = makeAdminEvent<Parameters<typeof leaderboardImportPOST>[0]>(authSub, payload)
  const response = await leaderboardImportPOST(event)
  const result = await response.json()
  console.log('Leaderboard import result:', result)
}

async function importStats(authSub: string, wb2: Wb2Parsed, replaceBatch: boolean) {
  if (wb2.stats.length === 0) {
    console.log('No stats rows found in wb2.json; skipping stats import.')
    return
  }

  const rows = wb2.stats.map((row) => ({
    player_name: pick(row, ['player', 'player_name', 'name']),
    agents: pick(row, ['agents', 'agent']),
    games: toNumber(pick(row, ['games', '# games'])),
    games_won: toNumber(pick(row, ['games_won', 'games won'])),
    games_lost: toNumber(pick(row, ['games_lost', 'games lost'])),
    rounds: toNumber(pick(row, ['rounds', '# rounds'])),
    rounds_won: toNumber(pick(row, ['rounds_won', 'rounds won'])),
    rounds_lost: toNumber(pick(row, ['rounds_lost', 'rounds lost'])),
    acs: toNumber(pick(row, ['acs'])),
    kd: toNumber(pick(row, ['kd', 'k/d'])),
    kast_pct: toPercent(pick(row, ['kast_pct', 'kast', 'kast%'])),
    adr: toNumber(pick(row, ['adr'])),
    kills: toNumber(pick(row, ['kills', 'k'])),
    kpg: toNumber(pick(row, ['kpg'])),
    kpr: toNumber(pick(row, ['kpr'])),
    deaths: toNumber(pick(row, ['deaths', 'd'])),
    dpg: toNumber(pick(row, ['dpg'])),
    dpr: toNumber(pick(row, ['dpr'])),
    assists: toNumber(pick(row, ['assists', 'a'])),
    apg: toNumber(pick(row, ['apg'])),
    apr: toNumber(pick(row, ['apr'])),
    fk: toNumber(pick(row, ['fk'])),
    fkpg: toNumber(pick(row, ['fkpg'])),
    fd: toNumber(pick(row, ['fd'])),
    fdpg: toNumber(pick(row, ['fdpg'])),
    hs_pct: toPercent(pick(row, ['hs_pct', 'hs%'])),
    plants: toNumber(pick(row, ['plants'])),
    plants_per_game: toNumber(pick(row, ['plants_per_game', 'plants per game', 'plants / game'])),
    defuses: toNumber(pick(row, ['defuses'])),
    defuses_per_game: toNumber(
      pick(row, ['defuses_per_game', 'defuses per game', 'defuses / game'])
    ),
    econ_rating: toNumber(pick(row, ['econ_rating', 'econ', 'econ rating'])),
    league_rank: pick(row, ['league rank', 'league_rank', 'rank']) as string | null,
  }))

  if (replaceBatch) {
    // Scope strictly to prior runs of THIS script: weekly uploads share the same
    // metadata.import_type, so filter on the sheets source filename too. approved_at
    // is never set by the stats import handler, so order by created_at.
    const { data: priorBatches } = await supabaseAdmin
      .from('stat_import_batches')
      .select('id')
      .eq('metadata->>import_type', 'rivals_group_stats')
      .eq('metadata->>import_kind', 'aggregate')
      .eq('source_filename', 'google-sheets-stats.xlsx')
      .order('created_at', { ascending: false })
      .limit(1)

    const priorBatchId = (priorBatches ?? [])[0]?.id
    if (priorBatchId) {
      console.log(`--replace-batch: deleting prior stats batch ${priorBatchId}`)
      await supabaseAdmin.from('rivals_group_stats').delete().eq('import_batch_id', priorBatchId)
      await supabaseAdmin.from('stat_import_errors').delete().eq('batch_id', priorBatchId)
      await supabaseAdmin.from('stat_import_batches').delete().eq('id', priorBatchId)
    }
  }

  const payload = {
    rows,
    sourceFilename: 'google-sheets-stats.xlsx',
    displayName: 'Google Sheets stats import',
    importKind: 'aggregate',
  }

  const event = makeAdminEvent<Parameters<typeof statsImportPOST>[0]>(authSub, payload)
  const response = await statsImportPOST(event)
  const result = await response.json()
  console.log('Stats import result:', result)
}

async function main() {
  const wb1File = path.join(OUT_DIR, 'wb1.json')
  const wb2File = path.join(OUT_DIR, 'wb2.json')
  if (!existsSync(wb1File) || !existsSync(wb2File)) {
    throw new Error('Run npm run sheets:fetch first (missing scripts/out/wb1.json or wb2.json)')
  }

  const adminOverride = argValue('--admin')
  const replaceBatch = process.argv.includes('--replace-batch')

  const wb1 = readJson<Wb1Parsed>(wb1File)
  const wb2 = readJson<Wb2Parsed>(wb2File)

  const { authSub } = await resolveAdminUserId(adminOverride)

  await importLeaderboard(authSub, wb1)
  await importStats(authSub, wb2, replaceBatch)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
