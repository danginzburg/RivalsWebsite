/**
 * Leaderboard CSV parsing, shared by the standalone import page and the inline
 * uploader in the Seasons tab so the two cannot drift on how columns are read.
 *
 * Rather than hard-coding a fixed set of accepted header layouts, the file is
 * parsed against a *mapping* from each canonical stat field to the CSV column
 * that holds it. `guessMapping` fills that in from the headers (so most imports
 * need no manual work), and the import page lets an admin correct it. Adding a
 * season whose sheet spells or orders its columns differently no longer means
 * editing this file.
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

export type LeaderboardField = keyof LeaderboardCsvRow

export type LeaderboardFieldSpec = {
  id: LeaderboardField
  label: string
  /** Import cannot proceed until a required field is mapped to a column. */
  required: boolean
  /**
   * Candidate header names, most specific first and compared case-insensitively
   * after trimming. `guessMapping` walks this list in order and takes the first
   * header present in the file, so `SERIES WINS` wins over a bare `WINS`.
   */
  aliases: string[]
}

/**
 * The canonical fields the leaderboard stores. Every field except TEAM and
 * POINTS is optional and defaults to 0 when unmapped, which is what lets a
 * lighter sheet (no round diff, say) import without inventing columns.
 *
 * The alias lists reproduce the two historical layouts on their own:
 *
 * - A modern sheet with `SERIES WINS`/`MAP WINS` maps each of those exactly.
 * - An older maps-only sheet has just `# MAPS`/`WINS`/`LOSSES`; the generic
 *   aliases point BOTH the series and the map fields at those columns, so the
 *   map record is mirrored into the series fields the events-page standings
 *   read — the same behaviour the old `maps_only` layout hard-coded. Several
 *   fields sharing one column is expected and allowed.
 */
export const LEADERBOARD_FIELDS: LeaderboardFieldSpec[] = [
  { id: 'team', label: 'Team', required: true, aliases: ['TEAM', 'TEAM NAME', 'NAME'] },
  { id: 'points', label: 'Points', required: true, aliases: ['POINTS', 'PTS'] },
  {
    id: 'series_played',
    label: 'Series Played',
    required: false,
    aliases: ['# SERIES', 'SERIES', 'SERIES PLAYED', 'GAMES', '# MAPS', 'MAPS'],
  },
  {
    id: 'series_wins',
    label: 'Series Wins',
    required: false,
    aliases: ['SERIES WINS', 'SERIES W', 'WINS', 'W'],
  },
  {
    id: 'series_losses',
    label: 'Series Losses',
    required: false,
    aliases: ['SERIES LOSSES', 'SERIES L', 'LOSSES', 'L'],
  },
  {
    id: 'maps_played',
    label: 'Maps Played',
    required: false,
    aliases: ['# MAPS', 'MAPS', 'MAPS PLAYED'],
  },
  {
    id: 'map_wins',
    label: 'Map Wins',
    required: false,
    aliases: ['MAP WINS', 'MAP W', 'WINS', 'W'],
  },
  {
    id: 'map_losses',
    label: 'Map Losses',
    required: false,
    aliases: ['MAP LOSSES', 'MAP L', 'LOSSES', 'L'],
  },
  {
    id: 'round_diff',
    label: 'Round Diff',
    required: false,
    aliases: ['ROUND DIFF', 'RD', 'DIFF', 'ROUND DIFFERENTIAL'],
  },
]

/** Field → the exact header (as it appears in the file) it reads, or null. */
export type LeaderboardMapping = Record<LeaderboardField, string | null>

export type ParsedLeaderboardCsv = {
  /** The mapping the rows were parsed with, recorded for the import audit. */
  mapping: LeaderboardMapping
  /** File headers no field mapped to — captured so callers can warn about them. */
  unmappedColumns: string[]
  rows: LeaderboardCsvRow[]
}

function normalizeHeader(value: string) {
  return value.trim().toUpperCase()
}

function parseInteger(value: string | undefined) {
  const n = Number(String(value ?? '').trim())
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

/** The non-empty rows of the file; the first is the header row. */
function splitRows(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0)
}

/** The trimmed, original-case column headers of the file. */
export function readCsvHeaders(text: string): string[] {
  const lines = splitRows(text)
  if (lines.length === 0) return []
  return lines[0].split(',').map((header) => header.trim())
}

/**
 * Best-guess mapping from headers: for each field, the first of its aliases
 * that appears in the file (case-insensitively). Fields with no matching
 * column are left null for the caller to fill in or leave unmapped.
 */
export function guessMapping(headers: string[]): LeaderboardMapping {
  const normalized = headers.map(normalizeHeader)
  const mapping = {} as LeaderboardMapping

  for (const field of LEADERBOARD_FIELDS) {
    let picked: string | null = null
    for (const alias of field.aliases) {
      const index = normalized.indexOf(normalizeHeader(alias))
      if (index !== -1) {
        picked = headers[index]
        break
      }
    }
    mapping[field.id] = picked
  }

  return mapping
}

/** Required fields the mapping has not assigned a column to. */
export function missingRequiredFields(mapping: LeaderboardMapping): LeaderboardFieldSpec[] {
  return LEADERBOARD_FIELDS.filter((field) => field.required && !mapping[field.id])
}

/** Headers present in the file that no field in the mapping reads. */
export function unmappedColumns(headers: string[], mapping: LeaderboardMapping): string[] {
  const used = new Set(
    Object.values(mapping)
      .filter((header): header is string => Boolean(header))
      .map(normalizeHeader)
  )
  return headers.filter((header) => !used.has(normalizeHeader(header)))
}

/**
 * Parses the file's data rows against an explicit mapping. Unmapped numeric
 * fields become 0; TEAM must be mapped (the import page guarantees this by
 * blocking on `missingRequiredFields`). Throws only on a structurally unusable
 * file, never on missing optional columns.
 */
export function parseLeaderboardCsvWithMapping(
  text: string,
  mapping: LeaderboardMapping
): ParsedLeaderboardCsv {
  const lines = splitRows(text)
  if (lines.length < 2) throw new Error('CSV must include a header and at least one data row')

  const headers = lines[0].split(',').map((header) => header.trim())
  const normalizedHeaders = headers.map(normalizeHeader)

  const columnIndex = (field: LeaderboardField) => {
    const header = mapping[field]
    return header ? normalizedHeaders.indexOf(normalizeHeader(header)) : -1
  }

  const teamIndex = columnIndex('team')
  if (teamIndex === -1) throw new Error('The TEAM column must be mapped before importing')

  const indices = {
    team: teamIndex,
    points: columnIndex('points'),
    series_played: columnIndex('series_played'),
    series_wins: columnIndex('series_wins'),
    series_losses: columnIndex('series_losses'),
    maps_played: columnIndex('maps_played'),
    map_wins: columnIndex('map_wins'),
    map_losses: columnIndex('map_losses'),
    round_diff: columnIndex('round_diff'),
  }

  const num = (parts: string[], index: number) => (index === -1 ? 0 : parseInteger(parts[index]))

  const rows = lines
    .slice(1)
    .map((line) => {
      const parts = line.split(',')
      return {
        team: parts[indices.team]?.trim() ?? '',
        points: num(parts, indices.points),
        series_played: num(parts, indices.series_played),
        series_wins: num(parts, indices.series_wins),
        series_losses: num(parts, indices.series_losses),
        maps_played: num(parts, indices.maps_played),
        map_wins: num(parts, indices.map_wins),
        map_losses: num(parts, indices.map_losses),
        round_diff: num(parts, indices.round_diff),
      }
    })
    /*
     * Sheets exports pad the range with placeholder rows like `,,0,,,0,,,` —
     * blank apart from a zero in a couple of numeric columns, so they survive
     * the empty-line filter above. A row with no team name is one of those,
     * and the import endpoint rejects the whole file over a single one.
     */
    .filter((row) => row.team.length > 0)

  return { mapping, unmappedColumns: unmappedColumns(headers, mapping), rows }
}

/**
 * Convenience for callers that import without a mapping UI (the Seasons-tab
 * inline uploader): guess the mapping, validate the required fields, and parse.
 * The interactive import page instead guesses, lets the admin adjust, and calls
 * `parseLeaderboardCsvWithMapping` directly.
 */
export function parseLeaderboardCsv(text: string): ParsedLeaderboardCsv {
  const headers = readCsvHeaders(text)
  if (headers.length === 0) throw new Error('CSV must include a header row')

  const mapping = guessMapping(headers)
  const missing = missingRequiredFields(mapping)
  if (missing.length > 0) {
    throw new Error(
      `Could not find a column for ${missing.map((field) => field.label).join(' and ')}. ` +
        `Headers found: ${headers.join(', ')}`
    )
  }

  return parseLeaderboardCsvWithMapping(text, mapping)
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
