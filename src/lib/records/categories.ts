/**
 * Stat record categories — what the Hall of Fame tracks record highs for.
 *
 * Shared by the rebuild (which stat column each category reads) and the page
 * (titles and formatting). The keys are stored in `stat_records.category`, so
 * renaming one is a migration; titles are display-only and safe to change.
 *
 * Every record is a single-map performance, and only highs are tracked.
 */

/** What a derived category sees of one player's map. */
export type PerformanceView = {
  stats: Record<string, number | null>
  roundsWon: number
  roundsLost: number
}

export type RecordCategory = {
  key: string
  holder: 'player' | 'team'
  /** Column on player_match_map_stats; team categories are derived from match_maps. */
  column?: string
  /**
   * For a value worked out from several columns rather than read from one.
   * `columns` lists what it reads so the rebuild loads them; returning null
   * leaves the performance out of the category.
   */
  derive?: { columns: string[]; value: (p: PerformanceView) => number | null }
  /**
   * Head-to-head: worked out between pairs of players on a map from the kill
   * feed (Riot-imported maps only), rather than from one player's own stats.
   */
  headToHead?: boolean
  title: string
  /** Short unit shown beside the value. */
  unit: string
  /** Decimal places the value is shown and compared at — ties are judged at this precision. */
  decimals: number
  /** Show a + on positive values (differentials). */
  signed?: boolean
}

/** a − b, when the source recorded both. */
function difference(p: PerformanceView, a: string, b: string): number | null {
  const x = p.stats[a]
  const y = p.stats[b]
  return x == null || y == null ? null : x - y
}

export const RECORD_CATEGORIES: RecordCategory[] = [
  {
    key: 'kills',
    holder: 'player',
    column: 'kills',
    title: 'Most kills',
    unit: 'kills',
    decimals: 0,
  },
  {
    key: 'kills_in_loss',
    holder: 'player',
    derive: {
      columns: ['kills'],
      value: (p) => (p.roundsWon < p.roundsLost ? (p.stats.kills ?? null) : null),
    },
    title: 'Most kills in a loss',
    unit: 'kills',
    decimals: 0,
  },
  {
    key: 'deaths',
    holder: 'player',
    column: 'deaths',
    title: 'Most deaths',
    unit: 'deaths',
    decimals: 0,
  },
  {
    key: 'assists',
    holder: 'player',
    column: 'assists',
    title: 'Most assists',
    unit: 'assists',
    decimals: 0,
  },
  {
    key: 'acs',
    holder: 'player',
    column: 'acs',
    title: 'Highest ACS',
    unit: 'ACS',
    decimals: 0,
  },
  {
    key: 'adr',
    holder: 'player',
    column: 'adr',
    title: 'Highest ADR',
    unit: 'ADR',
    decimals: 1,
  },
  {
    key: 'kd',
    holder: 'player',
    column: 'kd',
    title: 'Best K/D',
    unit: 'K/D',
    decimals: 2,
  },
  {
    key: 'kd_diff',
    holder: 'player',
    derive: { columns: ['kills', 'deaths'], value: (p) => difference(p, 'kills', 'deaths') },
    title: 'Highest K/D differential',
    unit: 'K−D',
    decimals: 0,
    signed: true,
  },
  {
    key: 'duel_diff',
    holder: 'player',
    headToHead: true,
    title: 'Biggest duel differential',
    unit: 'duel',
    decimals: 0,
    signed: true,
  },
  {
    key: 'fk_fd_diff',
    holder: 'player',
    derive: { columns: ['fk', 'fd'], value: (p) => difference(p, 'fk', 'fd') },
    title: 'Highest FK/FD differential',
    unit: 'FK−FD',
    decimals: 0,
    signed: true,
  },
  {
    key: 'kast_pct',
    holder: 'player',
    column: 'kast_pct',
    title: 'Highest KAST',
    unit: '% KAST',
    decimals: 0,
  },
  {
    key: 'hs_pct',
    holder: 'player',
    column: 'hs_pct',
    title: 'Highest headshot %',
    unit: '% HS',
    decimals: 0,
  },
  {
    key: 'fk',
    holder: 'player',
    column: 'fk',
    title: 'Most first kills',
    unit: 'FK',
    decimals: 0,
  },
  {
    key: 'fd',
    holder: 'player',
    column: 'fd',
    title: 'Most first deaths',
    unit: 'FD',
    decimals: 0,
  },
  {
    key: 'plants',
    holder: 'player',
    column: 'plants',
    title: 'Most plants',
    unit: 'plants',
    decimals: 0,
  },
  {
    key: 'defuses',
    holder: 'player',
    column: 'defuses',
    title: 'Most defuses',
    unit: 'defuses',
    decimals: 0,
  },
  {
    key: 'mk_3k',
    holder: 'player',
    column: 'mk_3k',
    title: 'Most 3Ks',
    unit: '3Ks',
    decimals: 0,
  },
  {
    key: 'mk_4k',
    holder: 'player',
    column: 'mk_4k',
    title: 'Most 4Ks',
    unit: '4Ks',
    decimals: 0,
  },
  {
    key: 'mk_5k',
    holder: 'player',
    column: 'mk_5k',
    title: 'Most aces',
    unit: 'aces',
    decimals: 0,
  },
  {
    key: 'clutches_won',
    holder: 'player',
    column: 'clutches_won',
    title: 'Most clutches won',
    unit: 'clutches',
    decimals: 0,
  },
  {
    key: 'map_margin',
    holder: 'team',
    title: 'Biggest map win',
    unit: 'round margin',
    decimals: 0,
  },
  {
    key: 'map_rounds',
    holder: 'team',
    title: 'Longest map',
    unit: 'rounds',
    decimals: 0,
  },
]

const BY_KEY = new Map(RECORD_CATEGORIES.map((c) => [c.key, c]))

export function getRecordCategory(key: string): RecordCategory | null {
  return BY_KEY.get(key) ?? null
}

export function recordTitle(key: string): string {
  return BY_KEY.get(key)?.title ?? key
}

export function formatRecordValue(key: string, value: number): string {
  const category = BY_KEY.get(key)
  const text = value.toFixed(category?.decimals ?? 0)
  return category?.signed && value > 0 ? `+${text}` : text
}

/** How many performances each category ranks. */
export const RECORD_TOP_N = 5

/** Records start with Rivals 5; earlier seasons and side leagues never count. */
export const FIRST_RECORD_SEASON_NUMBER = 5

export function isRecordSeasonCode(code: string | null | undefined): boolean {
  const m = /^rivals(\d+)$/i.exec(String(code ?? '').trim())
  return m !== null && Number(m[1]) >= FIRST_RECORD_SEASON_NUMBER
}
