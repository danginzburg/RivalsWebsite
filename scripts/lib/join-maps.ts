import type { Series } from './series'
import type { Wb2MapTab, Wb2RosterRow } from './parse-wb2'

export type TeamAlias = { teamId: string } | { create: { name: string; tag: string } }

export type JoinedMapRow = {
  mapIndex: number
  mapName: string
  teamARounds: number
  teamBRounds: number
  tabName: string | null
  joinMethod: 'override' | 'footer' | 'roster-overlap' | 'unjoined'
  playerRows: Record<string, unknown>[]
}

export type JoinedSeries = Series & {
  joinedMaps: JoinedMapRow[]
  unresolvedMapCount: number
}

export type TabOverrides = Record<string, string>

function normKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function dateKey(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  if (!raw) return 'no-date'

  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (dmy) {
    const year = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3])
    const month = Number(dmy[2])
    const day = Number(dmy[1])
    return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
      .toString()
      .padStart(2, '0')}`
  }

  const parsed = new Date(raw)
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  return normKey(raw)
}

function tabOrder(value: string | null): number {
  const match = String(value ?? '').match(/^(\d+)\s+m(\d+)$/i)
  if (!match) return Number.MAX_SAFE_INTEGER
  return Number(match[1]) * 10 + Number(match[2])
}

function playerNameColumn(row: Record<string, unknown>): string | null {
  for (const key of Object.keys(row)) {
    const k = key.toLowerCase().trim()
    if (k === 'player' || k === 'player_name' || k === 'player name' || k === 'name') {
      const value = row[key]
      return typeof value === 'string' ? value : value != null ? String(value) : null
    }
  }
  return null
}

function flipRowSide(row: Record<string, unknown>): Record<string, unknown> {
  const side = String(row.side ?? '').toLowerCase()
  if (side === 'a') return { ...row, side: 'b' }
  if (side === 'b') return { ...row, side: 'a' }
  return row
}

function rowsOrientedToSeries(
  tab: Wb2MapTab,
  seriesTeamAName: string,
  canonicalTeam: (value: string | null | undefined) => string
): Record<string, unknown>[] {
  if (!tab.footer.parsed || !tab.footer.teamA) return tab.playerRows
  return canonicalTeam(tab.footer.teamA) === canonicalTeam(seriesTeamAName)
    ? tab.playerRows
    : tab.playerRows.map(flipRowSide)
}

function buildRosterIndex(roster: Wb2RosterRow[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  for (const row of roster) {
    const team = row.team != null ? normKey(String(row.team)) : null
    const player = row.player_name != null ? normKey(String(row.player_name)) : null
    if (!team || !player) continue
    const set = index.get(team) ?? new Set<string>()
    set.add(player)
    index.set(team, set)
  }
  return index
}

function teamAliasGroup(alias: TeamAlias | undefined): string | null {
  if (!alias) return null
  if ('teamId' in alias) return `id:${alias.teamId}`
  return `create:${normKey(alias.create.name)}`
}

function buildTeamCanonicalizer(roster: Wb2RosterRow[], teamAliases: Record<string, TeamAlias>) {
  const aliases = new Map<string, string>()

  for (const [code, alias] of Object.entries(teamAliases)) {
    const group = teamAliasGroup(alias)
    if (group) aliases.set(normKey(code), group)
  }

  for (const row of roster) {
    const team = row.team != null ? normKey(String(row.team)) : ''
    const teamName = row.team_name != null ? normKey(String(row.team_name)) : ''
    const canonical = aliases.get(team) ?? aliases.get(teamName) ?? (team || teamName)
    if (!canonical) continue
    if (team) aliases.set(team, canonical)
    if (teamName) aliases.set(teamName, canonical)
  }

  return (value: string | null | undefined) => {
    const key = normKey(String(value ?? ''))
    return aliases.get(key) ?? key
  }
}

function scoreRosterOverlap(
  tab: Wb2MapTab,
  teamKey: string,
  rosterIndex: Map<string, Set<string>>
): number {
  const roster = rosterIndex.get(teamKey)
  if (!roster) return 0
  let overlap = 0
  for (const row of tab.playerRows) {
    const name = playerNameColumn(row)
    if (name && roster.has(normKey(name))) overlap++
  }
  return overlap
}

export function joinMapsToSeries(
  seriesList: Series[],
  mapTabs: Wb2MapTab[],
  roster: Wb2RosterRow[],
  overrides: TabOverrides,
  teamAliases: Record<string, TeamAlias> = {}
): { joined: JoinedSeries[]; unjoinedTabs: string[] } {
  const rosterIndex = buildRosterIndex(roster)
  const canonicalTeam = buildTeamCanonicalizer(roster, teamAliases)
  const usedTabs = new Set<string>()

  const overrideBySeriesKey = new Map<string, string>()
  for (const [tabName, seriesKey] of Object.entries(overrides)) {
    overrideBySeriesKey.set(seriesKey, tabName)
  }

  const tabsByFooterPair = new Map<string, Wb2MapTab[]>()
  for (const tab of mapTabs) {
    if (!tab.footer.parsed) continue
    const [a, b] = [canonicalTeam(tab.footer.teamA), canonicalTeam(tab.footer.teamB)].sort()
    const key = `${a}__${b}__${dateKey(tab.footer.date)}`
    const bucket = tabsByFooterPair.get(key) ?? []
    bucket.push(tab)
    tabsByFooterPair.set(key, bucket)
  }

  const joined: JoinedSeries[] = []

  for (const series of seriesList) {
    const joinedMaps: JoinedMapRow[] = series.maps.map((m, idx) => ({
      mapIndex: idx,
      mapName: m.mapName,
      teamARounds: m.teamARounds,
      teamBRounds: m.teamBRounds,
      tabName: null,
      joinMethod: 'unjoined',
      playerRows: [],
    }))

    const overrideTab = overrideBySeriesKey.get(series.key)
    if (overrideTab) {
      const tab = mapTabs.find((t) => t.tabName === overrideTab)
      if (tab && joinedMaps[0]) {
        joinedMaps[0].tabName = tab.tabName
        joinedMaps[0].joinMethod = 'override'
        joinedMaps[0].playerRows = rowsOrientedToSeries(tab, series.teamAName, canonicalTeam)
        usedTabs.add(tab.tabName)
      }
    } else {
      const [a, b] = [canonicalTeam(series.teamAName), canonicalTeam(series.teamBName)].sort()
      const footerKey = `${a}__${b}__${dateKey(series.date)}`
      const candidateTabs = (tabsByFooterPair.get(footerKey) ?? []).filter(
        (t) => !usedTabs.has(t.tabName)
      )

      candidateTabs.sort((x, y) => tabOrder(x.tabName) - tabOrder(y.tabName))

      for (let i = 0; i < joinedMaps.length && i < candidateTabs.length; i++) {
        const tab = candidateTabs[i]
        const matchesByName =
          !tab.footer.mapName || normKey(tab.footer.mapName) === normKey(joinedMaps[i].mapName)
        if (!matchesByName) continue
        joinedMaps[i].tabName = tab.tabName
        joinedMaps[i].joinMethod = 'footer'
        joinedMaps[i].playerRows = rowsOrientedToSeries(tab, series.teamAName, canonicalTeam)
        usedTabs.add(tab.tabName)
      }

      const stillUnjoined = joinedMaps.filter((m) => m.joinMethod === 'unjoined')
      if (stillUnjoined.length > 0) {
        const teamAKey = normKey(series.teamAName)
        const teamBKey = normKey(series.teamBName)
        const rosterCandidates = mapTabs.filter((t) => !usedTabs.has(t.tabName) && !t.footer.parsed)

        for (const tab of rosterCandidates) {
          const scoreA = scoreRosterOverlap(tab, teamAKey, rosterIndex)
          const scoreB = scoreRosterOverlap(tab, teamBKey, rosterIndex)
          if (scoreA === 0 && scoreB === 0) continue
          const target = stillUnjoined.shift()
          if (!target) break
          target.tabName = tab.tabName
          target.joinMethod = 'roster-overlap'
          target.playerRows = tab.playerRows
          usedTabs.add(tab.tabName)
        }
      }
    }

    joined.push({
      ...series,
      joinedMaps,
      unresolvedMapCount: joinedMaps.filter((m) => m.joinMethod === 'unjoined').length,
    })
  }

  const unjoinedTabs = mapTabs.map((t) => t.tabName).filter((name) => !usedTabs.has(name))

  return { joined, unjoinedTabs }
}
