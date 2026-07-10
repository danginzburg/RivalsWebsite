import type * as XLSX from 'xlsx'
import { listSheetNames, sheetRowsRaw, toText } from './sheets'

export type Wb1MapScore = {
  mapName: string
  teamScore: number
  oppScore: number
}

export type Wb1SeriesScore =
  | { kind: 'score'; teamWins: number; oppWins: number }
  | { kind: 'ffw' }
  | { kind: 'ffl' }

export type Wb1Row = {
  tabTeam: string
  opponent: string
  result: 'W' | 'L' | null
  date: string | null
  time: string | null
  stage: string | null
  seriesScore: Wb1SeriesScore
  seriesScoreRaw: string
  maps: Wb1MapScore[]
}

export type Wb1Parsed = {
  leaderboard: Record<string, unknown>[]
  teamTabs: Record<string, Wb1Row[]>
}

const LEADERBOARD_TAB_NAME = 'Leaderboard'
const NON_TEAM_TABS = new Set(['map rotation', 'leaderboard', 'groups'])

// Per-map score cells look like "Bind 13-7"; some sheets write "13-7 Bind" so we accept both orders.
const MAP_SCORE_RE =
  /^\s*(?:([A-Za-z' ]+?)\s+(\d+)\s*-\s*(\d+)|(\d+)\s*-\s*(\d+)\s+([A-Za-z' ]+))\s*$/

function parseSeriesScore(raw: string): Wb1SeriesScore | null {
  const trimmed = raw.trim().toUpperCase()
  if (!trimmed) return null
  if (trimmed === 'FFW') return { kind: 'ffw' }
  if (trimmed === 'FFL') return { kind: 'ffl' }
  const m = trimmed.match(/^(\d+)\s*-\s*(\d+)$/)
  if (!m) return null
  return { kind: 'score', teamWins: Number(m[1]), oppWins: Number(m[2]) }
}

function parseMapScoreCell(raw: string): Wb1MapScore | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const m = trimmed.match(MAP_SCORE_RE)
  if (!m) return null
  if (m[1] !== undefined) {
    return { mapName: m[1].trim(), teamScore: Number(m[2]), oppScore: Number(m[3]) }
  }
  return { mapName: m[6].trim(), teamScore: Number(m[4]), oppScore: Number(m[5]) }
}

function parseMapScores(raw: string): Wb1MapScore[] {
  return raw
    .split(/\s*>\s*/)
    .map(parseMapScoreCell)
    .filter((map): map is Wb1MapScore => Boolean(map))
}

function inferSeriesScore(result: Wb1Row['result'], maps: Wb1MapScore[]): Wb1SeriesScore | null {
  if (maps.length === 0) return null
  const teamWins = maps.filter((m) => m.teamScore > m.oppScore).length
  const oppWins = maps.filter((m) => m.oppScore > m.teamScore).length
  if (teamWins === oppWins) return null
  if (result === 'W') return { kind: 'score', teamWins, oppWins }
  if (result === 'L') return { kind: 'score', teamWins, oppWins }
  return null
}

function findNextRow(
  rows: unknown[][],
  start: number,
  maxOffset: number,
  predicate: (row: unknown[]) => boolean
) {
  for (let offset = 1; offset <= maxOffset; offset++) {
    const row = rows[start + offset]
    if (row && predicate(row)) return row
  }
  return null
}

function findHeaderIndex(header: string[], candidates: string[]): number {
  const normalized = header.map((h) => h.toLowerCase().trim())
  for (const candidate of candidates) {
    const idx = normalized.indexOf(candidate)
    if (idx !== -1) return idx
  }
  return -1
}

function parseTeamTab(tabName: string, rows: unknown[][]): Wb1Row[] {
  if (rows.length === 0) return []
  const header = rows[0].map(toText)

  const opponentIdx = findHeaderIndex(header, ['opponent', 'opp', 'vs'])
  const resultIdx = findHeaderIndex(header, ['result', 'w/l', 'w-l'])
  const dateIdx = findHeaderIndex(header, ['date'])
  const timeIdx = findHeaderIndex(header, ['time'])
  const stageIdx = findHeaderIndex(header, ['stage', 'phase'])
  const scoreIdx = findHeaderIndex(header, ['score', 'series score', 'series'])

  const mapColumnIndexes: number[] = []
  for (let i = 0; i < header.length; i++) {
    if ([opponentIdx, resultIdx, dateIdx, timeIdx, stageIdx, scoreIdx].includes(i)) continue
    if (/^map\s*\d+$/i.test(header[i]) || /^m\d+$/i.test(header[i])) {
      mapColumnIndexes.push(i)
    }
  }

  const parsed: Wb1Row[] = []

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row || row.every((cell) => cell === null || cell === undefined || cell === '')) continue

    const opponent = opponentIdx >= 0 ? toText(row[opponentIdx]) : ''
    if (!opponent) continue

    const resultRaw = resultIdx >= 0 ? toText(row[resultIdx]).toUpperCase() : ''
    const result: Wb1Row['result'] = resultRaw === 'W' ? 'W' : resultRaw === 'L' ? 'L' : null

    const seriesScoreRaw = scoreIdx >= 0 ? toText(row[scoreIdx]) : ''
    const seriesScore = parseSeriesScore(seriesScoreRaw)
    if (!seriesScore) continue

    const maps: Wb1MapScore[] = []
    for (const idx of mapColumnIndexes) {
      const parsedMap = parseMapScoreCell(toText(row[idx]))
      if (parsedMap) maps.push(parsedMap)
    }

    parsed.push({
      tabTeam: tabName,
      opponent,
      result,
      date: dateIdx >= 0 ? toText(row[dateIdx]) || null : null,
      time: timeIdx >= 0 ? toText(row[timeIdx]) || null : null,
      stage: stageIdx >= 0 ? toText(row[stageIdx]) || null : null,
      seriesScore,
      seriesScoreRaw,
      maps,
    })
  }

  if (parsed.length > 0) return parsed

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    const resultRaw = toText(row?.[0]).toUpperCase()
    const result: Wb1Row['result'] = resultRaw === 'W' ? 'W' : resultRaw === 'L' ? 'L' : null
    const opponent = toText(row?.[8])
    if (!result || !opponent) continue

    const scoreRaw = toText(row?.[4])
    const dateRow = findNextRow(rows, r, 4, (candidate) =>
      Boolean(toText(candidate[1]).match(/^\d{4}-\d{2}-\d{2}T/))
    )
    const mapsRow = findNextRow(rows, r, 5, (candidate) =>
      Boolean(toText(candidate[2]).includes('>') || parseMapScoreCell(toText(candidate[2])))
    )
    const maps = mapsRow ? parseMapScores(toText(mapsRow[2])) : []
    const seriesScore =
      parseSeriesScore(scoreRaw) ??
      (scoreRaw.toUpperCase() === 'FFW' ? { kind: 'ffw' as const } : null) ??
      (scoreRaw.toUpperCase() === 'FFL' ? { kind: 'ffl' as const } : null) ??
      inferSeriesScore(result, maps)

    if (!seriesScore) continue

    parsed.push({
      tabTeam: tabName,
      opponent,
      result,
      date: dateRow ? toText(dateRow[1]) || null : null,
      time: dateRow ? toText(dateRow[4]) || null : null,
      stage: dateRow ? toText(dateRow[7]) || null : null,
      seriesScore,
      seriesScoreRaw: scoreRaw,
      maps,
    })
  }

  return parsed
}

export function parseWb1(workbook: XLSX.WorkBook): Wb1Parsed {
  const sheetNames = listSheetNames(workbook)
  const leaderboardName =
    sheetNames.find((name) => name.toLowerCase() === LEADERBOARD_TAB_NAME.toLowerCase()) ?? null

  const leaderboardRows = leaderboardName
    ? (sheetRowsRaw(workbook, leaderboardName) as unknown[][])
    : []

  const leaderboard: Record<string, unknown>[] = []
  if (leaderboardRows.length > 0) {
    const header = leaderboardRows[0].map(toText)
    for (let r = 1; r < leaderboardRows.length; r++) {
      const row = leaderboardRows[r]
      if (!row || row.every((c) => c === null || c === undefined || c === '')) continue
      const record: Record<string, unknown> = {}
      header.forEach((key, i) => {
        record[key] = row[i] ?? null
      })
      leaderboard.push(record)
    }
  }

  const teamTabs: Record<string, Wb1Row[]> = {}
  for (const name of sheetNames) {
    if (leaderboardName && name === leaderboardName) continue
    if (NON_TEAM_TABS.has(name.toLowerCase())) continue
    const rawRows = sheetRowsRaw(workbook, name) as unknown[][]
    const rows = parseTeamTab(name, rawRows)
    if (rows.length > 0) teamTabs[name] = rows
  }

  return { leaderboard, teamTabs }
}
