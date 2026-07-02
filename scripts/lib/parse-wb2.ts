import type * as XLSX from 'xlsx'
import { listSheetNames, sheetRows, sheetRowsRaw, sheetRowsRawFormatted, toText } from './sheets'

export type Wb2StatRow = Record<string, unknown> & {
  player_name?: unknown
  team?: unknown
}

export type Wb2RosterRow = Record<string, unknown> & {
  team?: unknown
  team_name?: unknown
  player_name?: unknown
}

export type Wb2MapFooter = {
  teamA: string | null
  teamB: string | null
  date: string | null
  score: string | null
  mapName: string | null
  parsed: boolean
}

export type Wb2MapTab = {
  tabName: string
  playerRows: Record<string, unknown>[]
  footer: Wb2MapFooter
}

export type Wb2Parsed = {
  stats: Wb2StatRow[]
  roster: Wb2RosterRow[]
  mapTabs: Wb2MapTab[]
}

const STATS_TAB_CANDIDATES = ['stats']
const ROSTER_TAB_CANDIDATES = ['teams', 'roster', 'team roster', 'rosters']
const MAP_TAB_RE = /^(?:m\d+|\d+\s+m\d+)$/i

function findTabName(sheetNames: string[], candidates: string[]): string | null {
  const lower = sheetNames.map((n) => n.toLowerCase())
  for (const candidate of candidates) {
    const idx = lower.indexOf(candidate)
    if (idx !== -1) return sheetNames[idx]
  }
  return null
}

// Per-map tab footer rows describe match context (teams/date/score/map) and appear as loose
// key/value-ish cells below the player stat table rather than in a fixed header, so we scan
// every row for a small set of label keywords rather than assuming a row/column offset.
function parseFooter(rawRows: unknown[][]): Wb2MapFooter {
  const footer: Wb2MapFooter = {
    teamA: null,
    teamB: null,
    date: null,
    score: null,
    mapName: null,
    parsed: false,
  }

  for (const row of rawRows) {
    if (!row) continue
    for (let i = 0; i < row.length; i++) {
      const cell = toText(row[i]).toLowerCase()
      if (!cell) continue

      if (cell.startsWith('team a') || cell === 'teama') {
        footer.teamA = toText(row[i + 1]) || footer.teamA
      } else if (cell.startsWith('team b') || cell === 'teamb') {
        footer.teamB = toText(row[i + 1]) || footer.teamB
      } else if (cell === 'date') {
        footer.date = toText(row[i + 1]) || footer.date
      } else if (cell === 'score' || cell === 'series score') {
        footer.score = toText(row[i + 1]) || footer.score
      } else if (cell === 'map' || cell === 'map name') {
        footer.mapName = toText(row[i + 1]) || footer.mapName
      } else if (cell.includes(' vs ')) {
        const [a, b] = cell.split(' vs ').map((s) => s.trim())
        footer.teamA = footer.teamA ?? a ?? null
        footer.teamB = footer.teamB ?? b ?? null
      }
    }
  }

  for (const row of rawRows) {
    const teamA = toText(row?.[0])
    const teamB = toText(row?.[1])
    const date = toText(row?.[2])
    const leftScore = toText(row?.[3])
    const dash = toText(row?.[4])
    const rightScore = toText(row?.[5])
    const mapName = toText(row?.[7])
    if (teamA && teamB && date.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/)) {
      footer.teamA = footer.teamA ?? teamA
      footer.teamB = footer.teamB ?? teamB
      footer.date = footer.date ?? date
      footer.score = footer.score ?? [leftScore, dash, rightScore].filter(Boolean).join(' ')
      footer.mapName = footer.mapName ?? mapName
    }
  }

  footer.parsed = Boolean(footer.teamA && footer.teamB)
  return footer
}

function normalizeHeader(value: unknown): string {
  return toText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function parsePlayerRows(rawRows: unknown[][]): Record<string, unknown>[] {
  const headerIndex = rawRows.findIndex((row) =>
    row.some((cell) => normalizeHeader(cell) === 'player')
  )
  if (headerIndex < 0) return []

  const headers = rawRows[headerIndex].map(normalizeHeader)
  const playerColumn = headers.indexOf('player')
  const rows: Record<string, unknown>[] = []

  for (let r = headerIndex + 1; r < rawRows.length; r++) {
    const raw = rawRows[r]
    const playerName = toText(raw?.[playerColumn])
    if (!playerName) break

    const record: Record<string, unknown> = {}
    headers.forEach((key, i) => {
      if (key) record[key] = raw[i] ?? null
    })
    record.player_name = playerName
    record.agents = record.agent ?? null
    record.acs = record.avg_combat_score ?? record.acs ?? null
    record.kills = record.k ?? record.kills ?? null
    record.deaths = record.d ?? record.deaths ?? null
    record.assists = record.a ?? record.assists ?? null
    record.kd = record.k_d ?? record.kd ?? null
    record.kast_pct = record.kast ?? record.kast_pct ?? null
    record.hs_pct = record.hs ?? record.hs_pct ?? null
    record.econ_rating = record.econ_rating ?? null
    record.side = rows.length < 5 ? 'a' : 'b'
    rows.push(record)
  }

  return rows
}

function parseRosterRows(rawRows: unknown[][]): Wb2RosterRow[] {
  const rows: Wb2RosterRow[] = []
  for (const raw of rawRows) {
    const team = toText(raw?.[0])
    const teamName = toText(raw?.[1])
    if (!team || !teamName || team.toLowerCase() === 'team') continue

    for (let i = 2; i < raw.length; i++) {
      const playerName = toText(raw[i])
      if (!playerName) continue
      rows.push({ team, team_name: teamName, player_name: playerName })
    }
  }
  return rows
}

export function parseWb2(workbook: XLSX.WorkBook): Wb2Parsed {
  const sheetNames = listSheetNames(workbook)

  const statsTabName = findTabName(sheetNames, STATS_TAB_CANDIDATES)
  const stats = statsTabName ? sheetRows<Wb2StatRow>(workbook, statsTabName) : []

  const rosterTabName = findTabName(sheetNames, ROSTER_TAB_CANDIDATES)
  const roster = rosterTabName ? parseRosterRows(sheetRowsRaw(workbook, rosterTabName)) : []

  const mapTabs: Wb2MapTab[] = []
  for (const name of sheetNames) {
    if (!MAP_TAB_RE.test(name)) continue
    const rawRows = sheetRowsRaw(workbook, name)
    const formattedRows = sheetRowsRawFormatted(workbook, name)
    const playerRows = parsePlayerRows(rawRows)
    mapTabs.push({
      tabName: name,
      playerRows,
      footer: parseFooter(formattedRows),
    })
  }

  return { stats, roster, mapTabs }
}
