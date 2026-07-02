import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { OUT_DIR, DATA_DIR, readJson } from './lib/cli'
import {
  buildProfileMatcher,
  buildTeamMatcher,
  getApprovedTeamsForImports,
  getProfilesForImports,
  normalizeImportKey,
} from '../src/lib/server/imports/matching'
import type { Wb1Parsed } from './lib/parse-wb1'
import type { Wb2Parsed } from './lib/parse-wb2'

type TeamAlias = { teamId: string } | { create: { name: string; tag: string } }
type PlayerAlias = { profileId: string; statsPlayerName?: string } | null

function collectTeamCodes(wb1: Wb1Parsed): string[] {
  const codes = new Set<string>()
  for (const tabName of Object.keys(wb1.teamTabs)) codes.add(tabName)
  for (const rows of Object.values(wb1.teamTabs)) {
    for (const row of rows) codes.add(row.opponent)
  }
  for (const row of wb1.leaderboard) {
    const team = row.team ?? row.TEAM ?? row.Team
    if (typeof team === 'string' && team.trim()) codes.add(team.trim())
  }
  return Array.from(codes)
}

function collectPlayerNames(wb2: Wb2Parsed): string[] {
  const names = new Set<string>()
  for (const row of wb2.stats) {
    const name = row.player_name
    if (typeof name === 'string' && name.trim()) names.add(name.trim())
  }
  for (const tab of wb2.mapTabs) {
    for (const row of tab.playerRows) {
      for (const key of Object.keys(row)) {
        if (key.toLowerCase().trim() === 'player' || key.toLowerCase().trim() === 'player_name') {
          const value = row[key]
          if (typeof value === 'string' && value.trim()) names.add(value.trim())
        }
      }
    }
  }
  return Array.from(names)
}

async function main() {
  const force = process.argv.includes('--force')

  const wb1File = path.join(OUT_DIR, 'wb1.json')
  const wb2File = path.join(OUT_DIR, 'wb2.json')
  if (!existsSync(wb1File) || !existsSync(wb2File)) {
    throw new Error('Run npm run sheets:fetch first (missing scripts/out/wb1.json or wb2.json)')
  }

  const wb1 = readJson<Wb1Parsed>(wb1File)
  const wb2 = readJson<Wb2Parsed>(wb2File)

  const teamsFile = path.join(DATA_DIR, 'aliases.teams.json')
  const playersFile = path.join(DATA_DIR, 'aliases.players.json')

  const existingTeamAliases = readJson<Record<string, TeamAlias | { _meta?: unknown }>>(teamsFile)
  const existingPlayerAliases = readJson<Record<string, PlayerAlias>>(playersFile)

  const [dbTeams, dbProfiles] = await Promise.all([
    getApprovedTeamsForImports(),
    getProfilesForImports(),
  ])
  const teamMatcher = buildTeamMatcher(dbTeams)
  const profileMatcher = buildProfileMatcher(dbProfiles)

  const teamCodes = collectTeamCodes(wb1)
  const nextTeamAliases: Record<string, unknown> = { ...existingTeamAliases }
  const unresolvedTeams: string[] = []

  for (const code of teamCodes) {
    const key = code
    const hasHumanEntry =
      Object.prototype.hasOwnProperty.call(existingTeamAliases, key) && key !== '_meta'
    if (hasHumanEntry && !force) continue

    const match = teamMatcher.byMatchName(code) ?? teamMatcher.byLeaderboardTag(code)
    if (match) {
      nextTeamAliases[key] = { teamId: match.id }
    } else if (!hasHumanEntry) {
      unresolvedTeams.push(code)
    }
  }

  const playerNames = collectPlayerNames(wb2)
  const nextPlayerAliases: Record<string, PlayerAlias> = { ...existingPlayerAliases }
  const unresolvedPlayers: string[] = []

  for (const name of playerNames) {
    const key = normalizeImportKey(name)
    const hasHumanEntry = Object.prototype.hasOwnProperty.call(existingPlayerAliases, key)
    if (hasHumanEntry && !force) continue

    const profileId = profileMatcher.resolve(name)
    if (profileId) {
      nextPlayerAliases[key] = { profileId }
    } else if (!hasHumanEntry) {
      nextPlayerAliases[key] = null
      unresolvedPlayers.push(name)
    }
  }

  writeFileSync(teamsFile, JSON.stringify(nextTeamAliases, null, 2))
  writeFileSync(playersFile, JSON.stringify(nextPlayerAliases, null, 2))

  console.log(`Team codes seen: ${teamCodes.length}`)
  console.log(
    `Unresolved teams (no existing DB match, not already in aliases file): ${unresolvedTeams.length}`
  )
  for (const t of unresolvedTeams) console.log(`  - ${t}`)

  console.log(`Player names seen: ${playerNames.length}`)
  console.log(`Unresolved players (accepted as profileId: null): ${unresolvedPlayers.length}`)
  for (const p of unresolvedPlayers) console.log(`  - ${p}`)

  console.log(`Wrote ${teamsFile} and ${playersFile}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
