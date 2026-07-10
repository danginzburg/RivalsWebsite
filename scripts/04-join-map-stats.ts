import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { OUT_DIR, DATA_DIR, readJson, readTeamAliases } from './lib/cli'
import { joinMapsToSeries, type TabOverrides } from './lib/join-maps'
import type { Series } from './lib/series'
import type { Wb2Parsed } from './lib/parse-wb2'
import { normalizeImportKey } from '../src/lib/server/imports/matching'
import { numberFromRow, percentFromRow, playerNameFromRow, stringFromRow } from './lib/row-fields'

type PlayerAlias = { profileId: string; statsPlayerName?: string } | null

function sideFromRow(row: Record<string, unknown>): 'a' | 'b' {
  const side = stringFromRow(row, ['side', 'team side'])
  return side && side.toLowerCase().startsWith('b') ? 'b' : 'a'
}

export type ImportSeriesPayload = {
  seriesKey: string
  bestOf: number
  displayName: string
  sourceFilename: string
  maps: Array<{
    source: string
    teamAName: string
    teamBName: string
    teamARounds: number
    teamBRounds: number
    mapName: string | null
    scheduledAt: string | null
    playerRows: Array<{
      player_name: string
      agents: string | null
      side: 'a' | 'b'
      profile_id: string | null
      acs: number
      kills: number
      deaths: number
      assists: number
      kd: number
      adr: number
      kast_pct: number
      fk: number
      fd: number
      hs_pct: number
      plants: number
      defuses: number
      econ_rating: number
    }>
  }>
}

async function main() {
  const seriesFile = path.join(OUT_DIR, 'series.json')
  const wb2File = path.join(OUT_DIR, 'wb2.json')
  const overridesFile = path.join(DATA_DIR, 'tab-overrides.json')
  const playersFile = path.join(DATA_DIR, 'aliases.players.json')
  const teamsFile = path.join(DATA_DIR, 'aliases.teams.json')

  if (!existsSync(seriesFile))
    throw new Error('Run npm run sheets:series first (missing series.json)')
  if (!existsSync(wb2File)) throw new Error('Run npm run sheets:fetch first (missing wb2.json)')

  const series = readJson<Series[]>(seriesFile)
  const wb2 = readJson<Wb2Parsed>(wb2File)
  const overrides = readJson<TabOverrides>(overridesFile)
  const playerAliases = readJson<Record<string, PlayerAlias>>(playersFile)
  const teamAliases = readTeamAliases(teamsFile)

  const { joined, unjoinedTabs } = joinMapsToSeries(
    series,
    wb2.mapTabs,
    wb2.roster,
    overrides,
    teamAliases
  )

  const payloads: ImportSeriesPayload[] = joined.map((s) => ({
    seriesKey: s.key,
    bestOf: s.bestOf,
    displayName: `${s.teamAName} vs ${s.teamBName} (${s.date ?? 'unknown date'})`,
    sourceFilename: 'google-sheets-import',
    maps: s.joinedMaps.map((m) => ({
      source: m.tabName ?? 'unjoined',
      teamAName: s.teamAName,
      teamBName: s.teamBName,
      teamARounds: m.teamARounds,
      teamBRounds: m.teamBRounds,
      mapName: m.mapName || null,
      scheduledAt: s.date,
      playerRows: m.playerRows.map((row) => {
        const playerName = playerNameFromRow(row) ?? 'Unknown Player'
        const alias = playerAliases[normalizeImportKey(playerName)]
        return {
          player_name: playerName,
          agents: stringFromRow(row, ['agents', 'agent']),
          side: sideFromRow(row),
          profile_id: alias?.profileId ?? null,
          acs: numberFromRow(row, ['acs']),
          kills: numberFromRow(row, ['kills', 'k']),
          deaths: numberFromRow(row, ['deaths', 'd']),
          assists: numberFromRow(row, ['assists', 'a']),
          kd: numberFromRow(row, ['kd', 'k/d']),
          adr: numberFromRow(row, ['adr']),
          kast_pct: percentFromRow(row, ['kast_pct', 'kast', 'kast%']),
          fk: numberFromRow(row, ['fk', 'first kills']),
          fd: numberFromRow(row, ['fd', 'first deaths']),
          hs_pct: percentFromRow(row, ['hs_pct', 'hs%', 'headshot%']),
          plants: numberFromRow(row, ['plants']),
          defuses: numberFromRow(row, ['defuses']),
          econ_rating: numberFromRow(row, ['econ_rating', 'econ']),
        }
      }),
    })),
  }))

  writeFileSync(path.join(OUT_DIR, 'joined.json'), JSON.stringify(payloads, null, 2))

  const seriesLackingStats = joined.filter((s) => s.unresolvedMapCount === s.maps.length)
  const seriesPartiallyJoined = joined.filter(
    (s) => s.unresolvedMapCount > 0 && s.unresolvedMapCount < s.maps.length
  )

  console.log(`Joined ${joined.length} series.`)
  console.log(`Unjoined wb2 map tabs: ${unjoinedTabs.length}`)
  for (const t of unjoinedTabs) console.log(`  - ${t}`)
  console.log(`Series with zero map stats joined: ${seriesLackingStats.length}`)
  for (const s of seriesLackingStats) console.log(`  - ${s.key}`)
  console.log(`Series partially joined (some maps missing stats): ${seriesPartiallyJoined.length}`)
  for (const s of seriesPartiallyJoined)
    console.log(`  - ${s.key} (${s.unresolvedMapCount}/${s.maps.length} unjoined)`)

  console.log(`Wrote ${path.join(OUT_DIR, 'joined.json')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
