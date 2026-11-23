/** Site-wide quick search: the index the server sends and the matcher that filters it. */

export type SearchPlayer = {
  /** Profile id, the /players/[id] param. */
  id: string
  name: string
  /** Every approved Riot ID (name and name#tag), so a search by an alt still finds them. */
  riotIds: string[]
  avatarUrl: string | null
  /** Their most recent team, for the subtitle. */
  team: string | null
  teamSeason: string | null
}

export type SearchTeam = {
  id: string
  name: string
  tag: string | null
  logoUrl: string | null
  season: string | null
  seasonStartsOn: string | null
  /** Belongs to an external event, which the site hides unless the viewer opts in. */
  external: boolean
}

export type SearchIndex = { players: SearchPlayer[]; teams: SearchTeam[] }

export type SearchResults = { players: SearchPlayer[]; teams: SearchTeam[] }

/** Lowercase, strip accents and drop anything that isn't a letter, digit or '#'. */
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#]+/gu, ' ')
    .trim()
}

/**
 * How well `query` matches `candidate`, both already normalized: 3 for an
 * exact match, 2 for a prefix, 1 for the start of a later word, 0.5 for
 * anywhere inside, 0 for no match.
 */
function scoreText(candidate: string, query: string): number {
  if (!candidate) return 0
  if (candidate === query) return 3
  if (candidate.startsWith(query)) return 2
  if (candidate.includes(` ${query}`)) return 1
  if (candidate.includes(query)) return 0.5
  return 0
}

function bestScore(candidates: Array<string | null | undefined>, query: string): number {
  let best = 0
  for (const candidate of candidates) {
    if (!candidate) continue
    best = Math.max(best, scoreText(normalizeSearch(candidate), query))
    if (best === 3) break
  }
  return best
}

function topBy<T>(items: T[], score: (item: T) => number, limit: number): T[] {
  return items
    .map((item, order) => ({ item, order, score: score(item) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((entry) => entry.item)
}

/**
 * Filter the index for a query. A player's display name outranks a match on
 * one of their Riot IDs; teams keep the index's newest-season-first order
 * among equal matches, and a name that recurs across seasons shows each one.
 */
export function searchIndex(
  index: SearchIndex,
  rawQuery: string,
  options: { includeExternal?: boolean; limit?: number } = {}
): SearchResults {
  const query = normalizeSearch(rawQuery)
  if (!query) return { players: [], teams: [] }
  const limit = options.limit ?? 6

  const players = topBy(
    index.players,
    (player) => {
      const nameScore = scoreText(normalizeSearch(player.name), query)
      // The small bonus breaks ties toward the name people know them by.
      return Math.max(nameScore ? nameScore + 0.1 : 0, bestScore(player.riotIds, query))
    },
    limit
  )

  const teams = topBy(
    index.teams.filter((team) => options.includeExternal || !team.external),
    (team) => bestScore([team.name, team.tag], query),
    limit
  )

  return { players, teams }
}
