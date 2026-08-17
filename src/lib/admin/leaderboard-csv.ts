/**
 * Leaderboard CSV parsing, shared by the standalone import page and the inline
 * uploader in the Seasons tab so the two cannot drift on which columns they
 * accept.
 *
 * Row order is meaningful: `/api/admin/leaderboard/import` assigns ranks from
 * it, so rows are never sorted here.
 */

export type LeaderboardCsvRow = {
  team: string
  points: number
  series_played: number
  series_wins: number
  series_losses: number
  maps_played: number
  map_wins: number
  map_losses: number
  round_diff: number
}

/**
 * Seasons were not scored the same way throughout, so more than one header
 * layout is accepted:
 *
 * - `series_and_maps` — the current sheet, which splits series from maps.
 * - `maps_only` — the older sheet, which counted maps alone. Its WINS/LOSSES
 *   are map results (they sum to `# MAPS`), and there is no series record at
 *   all, so the map figures are mirrored into the series fields. Without that
 *   the season standings on the events page, which read the series columns,
 *   would show every team at 0-0.
 */
export type LeaderboardCsvLayout = 'series_and_maps' | 'maps_only'

const LAYOUTS: Array<{ id: LeaderboardCsvLayout; columns: string[] }> = [
  {
    id: 'series_and_maps',
    columns: [
      'TEAM',
      'POINTS',
      '# SERIES',
      'SERIES WINS',
      'SERIES LOSSES',
      '# MAPS',
      'MAP WINS',
      'MAP LOSSES',
      'ROUND DIFF',
    ],
  },
  {
    id: 'maps_only',
    columns: ['TEAM', 'POINTS', '# MAPS', 'WINS', 'LOSSES', 'ROUND DIFF'],
  },
]

export type ParsedLeaderboardCsv = {
  layout: LeaderboardCsvLayout
  rows: LeaderboardCsvRow[]
}

function parseInteger(value: string) {
  const n = Number(String(value ?? '').trim())
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

export function parseLeaderboardCsv(text: string): ParsedLeaderboardCsv {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length < 2) throw new Error('CSV must include a header and at least one data row')

  const headers = lines[0].split(',').map((header) => header.trim().toUpperCase())
  const layout = LAYOUTS.find((candidate) =>
    candidate.columns.every((column) => headers.includes(column))
  )

  if (!layout) {
    throw new Error(
      `Unrecognised leaderboard CSV. Expected either "${LAYOUTS[0].columns.join(', ')}" or "${LAYOUTS[1].columns.join(', ')}", got "${headers.join(', ')}"`
    )
  }

  const at = (parts: string[], name: string) => parts[headers.indexOf(name)]

  const rows = lines
    .slice(1)
    .map((line) => {
      const parts = line.split(',')
      const team = at(parts, 'TEAM')?.trim() ?? ''
      const points = parseInteger(at(parts, 'POINTS'))
      const roundDiff = parseInteger(at(parts, 'ROUND DIFF'))

      if (layout.id === 'maps_only') {
        const mapsPlayed = parseInteger(at(parts, '# MAPS'))
        const wins = parseInteger(at(parts, 'WINS'))
        const losses = parseInteger(at(parts, 'LOSSES'))
        return {
          team,
          points,
          series_played: mapsPlayed,
          series_wins: wins,
          series_losses: losses,
          maps_played: mapsPlayed,
          map_wins: wins,
          map_losses: losses,
          round_diff: roundDiff,
        }
      }

      return {
        team,
        points,
        series_played: parseInteger(at(parts, '# SERIES')),
        series_wins: parseInteger(at(parts, 'SERIES WINS')),
        series_losses: parseInteger(at(parts, 'SERIES LOSSES')),
        maps_played: parseInteger(at(parts, '# MAPS')),
        map_wins: parseInteger(at(parts, 'MAP WINS')),
        map_losses: parseInteger(at(parts, 'MAP LOSSES')),
        round_diff: roundDiff,
      }
    })
    /*
     * Sheets exports pad the range with placeholder rows like `,,0,,,0,,,` —
     * blank apart from a zero in a couple of numeric columns, so they survive
     * the empty-line filter above. A row with no team name is one of those,
     * and the import endpoint rejects the whole file over a single one.
     */
    .filter((row) => row.team.length > 0)

  return { layout: layout.id, rows }
}

/** Reads a picked file and parses it, so callers do not each wrap FileReader. */
export function readLeaderboardCsvFile(file: File): Promise<ParsedLeaderboardCsv> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read the CSV file'))
    reader.onload = (event) => {
      try {
        resolve(parseLeaderboardCsv(String(event.target?.result ?? '')))
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Failed to parse leaderboard CSV'))
      }
    }
    reader.readAsText(file)
  })
}
