import type { Wb1Row } from './parse-wb1'
import type { TeamAlias } from './cli'

export type SeriesMap = {
  mapName: string
  teamARounds: number
  teamBRounds: number
}

export type Series = {
  key: string
  teamAName: string
  teamBName: string
  date: string | null
  time: string | null
  stage: string | null
  bestOf: number
  teamASeriesWins: number
  teamBSeriesWins: number
  maps: SeriesMap[]
  sourceRows: { tabTeam: string; opponent: string }[]
}

export type SeriesBuildResult = {
  series: Series[]
  mismatches: Array<{ key: string; reason: string; rows: Wb1Row[] }>
  skippedForfeits: Wb1Row[]
  skippedNonRegularSeason: Wb1Row[]
}

function normKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function aliasKey(team: string, teamAliases: Record<string, TeamAlias>): string {
  const alias = teamAliases[team]
  if (!alias) return normKey(team)
  if ('teamId' in alias) return `id:${alias.teamId}`
  return `create:${normKey(alias.create.name)}`
}

function displayKeyPart(value: string): string {
  return normKey(value)
}

function pairKey(
  teamA: string,
  teamB: string,
  date: string | null,
  teamAliases: Record<string, TeamAlias>
): string {
  const [a, b] = [aliasKey(teamA, teamAliases), aliasKey(teamB, teamAliases)].sort()
  return `${a}__${b}__${date ?? 'no-date'}`
}

function inferBestOf(mapCount: number): number {
  if (mapCount >= 5) return 5
  if (mapCount >= 3) return 3
  return 1
}

export function isRegularSeason(stage: string | null): boolean {
  if (!stage) return true
  const s = stage.trim().toLowerCase()
  return !s.includes('preseason') && !s.includes('playoff') && !s.includes('playoffs')
}

// Team names stay as raw sheet codes/tab names throughout the pipeline; alias
// resolution happens only at apply time (06/07) so alias-file keys always match.
export function buildSeries(
  teamTabs: Record<string, Wb1Row[]>,
  teamAliases: Record<string, TeamAlias> = {}
): SeriesBuildResult {
  const allRows: Wb1Row[] = []
  for (const rows of Object.values(teamTabs)) allRows.push(...rows)

  const skippedForfeits: Wb1Row[] = []
  const skippedNonRegularSeason: Wb1Row[] = []
  const grouped = new Map<string, Wb1Row[]>()

  for (const row of allRows) {
    if (row.seriesScore.kind === 'ffw' || row.seriesScore.kind === 'ffl') {
      skippedForfeits.push(row)
      continue
    }
    if (!isRegularSeason(row.stage)) {
      skippedNonRegularSeason.push(row)
      continue
    }

    const key = pairKey(row.tabTeam, row.opponent, row.date, teamAliases)
    const bucket = grouped.get(key) ?? []
    bucket.push(row)
    grouped.set(key, bucket)
  }

  const series: Series[] = []
  const mismatches: SeriesBuildResult['mismatches'] = []

  for (const [groupKey, rows] of grouped.entries()) {
    const key = (() => {
      const first = rows[0]
      if (!first) return groupKey
      const [a, b] = [displayKeyPart(first.tabTeam), displayKeyPart(first.opponent)].sort()
      return `${a}__${b}__${first.date ?? 'no-date'}`
    })()

    if (rows.length === 1) {
      mismatches.push({ key, reason: 'Only one mirrored row found (expected 2)', rows })
      continue
    }
    if (rows.length > 2) {
      mismatches.push({ key, reason: `Expected 2 mirrored rows, found ${rows.length}`, rows })
      continue
    }

    const [rowA, rowB] = rows
    const scoreA = rowA.seriesScore
    const scoreB = rowB.seriesScore
    if (scoreA.kind !== 'score' || scoreB.kind !== 'score') {
      mismatches.push({ key, reason: 'Non-score series score after forfeit filter', rows })
      continue
    }

    if (scoreA.teamWins !== scoreB.oppWins || scoreA.oppWins !== scoreB.teamWins) {
      mismatches.push({
        key,
        reason: `Mirrored rows disagree on series score: ${rowA.seriesScoreRaw} vs ${rowB.seriesScoreRaw}`,
        rows,
      })
      continue
    }

    if (rowA.maps.length !== rowB.maps.length) {
      mismatches.push({
        key,
        reason: `Mirrored rows disagree on map count: ${rowA.maps.length} vs ${rowB.maps.length}`,
        rows,
      })
      continue
    }

    const scoreMirrorBroken = rowA.maps.some(
      (m, idx) => rowB.maps[idx].teamScore !== m.oppScore || rowB.maps[idx].oppScore !== m.teamScore
    )
    if (scoreMirrorBroken) {
      mismatches.push({ key, reason: 'Mirrored rows disagree on per-map scores', rows })
      continue
    }

    const maps: SeriesMap[] = rowA.maps.map((m) => ({
      mapName: m.mapName,
      teamARounds: m.teamScore,
      teamBRounds: m.oppScore,
    }))

    series.push({
      key,
      teamAName: rowA.tabTeam,
      teamBName: rowA.opponent,
      date: rowA.date,
      time: rowA.time,
      stage: rowA.stage,
      bestOf: inferBestOf(maps.length),
      teamASeriesWins: scoreA.teamWins,
      teamBSeriesWins: scoreA.oppWins,
      maps,
      sourceRows: [
        { tabTeam: rowA.tabTeam, opponent: rowA.opponent },
        { tabTeam: rowB.tabTeam, opponent: rowB.opponent },
      ],
    })
  }

  return { series, mismatches, skippedForfeits, skippedNonRegularSeason }
}
