import { env } from '$env/dynamic/private'
import { TtlCache } from '$lib/server/cache'
import { RiotLookupError } from './henrik'
import { derivePlayerStats, type DerivedPlayerStats, type RiotMatch } from './match-stats'

/**
 * Fetch a finished Valorant match from the HenrikDev API and shape it into the
 * payload `importCompletedSeries` already accepts.
 *
 * Why this route rather than scraping tracker.gg: `/v4/match/{region}/{id}`
 * answers on the match id alone, over plain `fetch`, with no Cloudflare bot
 * check in the way. A tracker.gg match URL ends in that same Riot match id, so
 * pasting a tracker link and pasting an id are the same operation.
 */

const BASE = 'https://api.henrikdev.xyz/valorant'

/** Finished matches never change, so this only ever saves a repeat import. */
const matchCache = new TtlCache<RiotMatchDetail>({ ttlMs: 60 * 60_000, maxEntries: 100 })

export const MATCH_REGIONS = ['na', 'eu', 'ap', 'kr', 'br', 'latam'] as const
export type MatchRegion = (typeof MATCH_REGIONS)[number]

export type RiotMatchTeam = {
  /** 'Red' or 'Blue' as the API reports it. */
  id: string
  roundsWon: number
  roundsLost: number
  won: boolean
}

export type RiotMatchDetail = {
  matchId: string
  map: string | null
  startedAt: string | null
  queue: string | null
  /** True once Riot considers the match finished; a live match has partial stats. */
  isCompleted: boolean
  teams: RiotMatchTeam[]
  players: DerivedPlayerStats[]
  roundCount: number
}

function headers(): Record<string, string> {
  const key = env.HENRIKDEV_API_KEY
  return key ? { Authorization: key } : {}
}

type MatchPayload = RiotMatch & {
  metadata?: {
    match_id?: string | null
    map?: { name?: string | null } | null
    started_at?: string | null
    is_completed?: boolean | null
    queue?: { name?: string | null } | null
  } | null
  teams?: Array<{
    team_id?: string | null
    rounds?: { won?: number | null; lost?: number | null } | null
    won?: boolean | null
  }> | null
}

/**
 * Read one match. `region` is part of the URL rather than discovered, because
 * the endpoint gives no way to search for a match across regions.
 */
export async function fetchMatch(matchId: string, region: MatchRegion): Promise<RiotMatchDetail> {
  const cacheKey = `${region}:${matchId}`
  const cached = matchCache.get(cacheKey)
  if (cached) return cached

  let response: Response
  try {
    response = await fetch(`${BASE}/v4/match/${region}/${encodeURIComponent(matchId)}`, {
      headers: headers(),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new RiotLookupError(503, 'Could not reach the Riot match service. Try again shortly.')
  }

  if (response.status === 404) {
    throw new RiotLookupError(
      404,
      `No match found for that id in ${region.toUpperCase()}. Check the region if the link came from another one.`
    )
  }
  if (response.status === 429) {
    throw new RiotLookupError(
      429,
      'Riot match lookup is rate limited right now. Try again shortly.'
    )
  }
  if (!response.ok) {
    throw new RiotLookupError(502, `Riot match lookup failed (HTTP ${response.status}).`)
  }

  const body = (await response.json().catch(() => null)) as { data?: MatchPayload } | null
  const data = body?.data
  if (!data || !Array.isArray(data.players)) {
    throw new RiotLookupError(502, 'Riot match lookup returned an unexpected response.')
  }

  const detail: RiotMatchDetail = {
    matchId: data.metadata?.match_id ?? matchId,
    map: data.metadata?.map?.name ?? null,
    startedAt: data.metadata?.started_at ?? null,
    queue: data.metadata?.queue?.name ?? null,
    isCompleted: data.metadata?.is_completed !== false,
    teams: (data.teams ?? []).map((team) => ({
      id: String(team.team_id ?? ''),
      roundsWon: team.rounds?.won ?? 0,
      roundsLost: team.rounds?.lost ?? 0,
      won: Boolean(team.won),
    })),
    players: derivePlayerStats({
      players: data.players,
      rounds: data.rounds ?? [],
      kills: data.kills ?? [],
    }),
    roundCount: data.rounds?.length ?? 0,
  }

  matchCache.set(cacheKey, detail)
  return detail
}

/** One map of a series, in the shape `importCompletedSeries` expects. */
export type ImportMapPayload = {
  sourceFilename: string
  mapName: string | null
  scheduledAt: string | null
  teamAName: string
  teamBName: string
  teamARounds: number
  teamBRounds: number
  playerRows: Array<Record<string, unknown>>
}

/**
 * Turn a fetched match into one map of an import payload.
 *
 * `teamAValorantSide` says which of the API's Red/Blue teams is the series'
 * team A. That mapping cannot be inferred from the match — Riot has no notion
 * of the league's teams — so the caller resolves it from the roster and passes
 * it in.
 *
 * Multikills and clutch totals go to their own columns; only the per-size
 * clutch breakdown rides along in `metadata`, since a 1v1 and a 1v5 are both
 * just wins in `clutches_won`.
 */
export function toImportMap(
  match: RiotMatchDetail,
  options: {
    teamAValorantSide: string
    teamAName: string
    teamBName: string
    mapOrder: number
  }
): ImportMapPayload {
  const { teamAValorantSide, teamAName, teamBName, mapOrder } = options

  const roundsFor = (side: string) => match.teams.find((t) => t.id === side)?.roundsWon ?? 0
  const teamBValorantSide = match.teams.find((t) => t.id !== teamAValorantSide)?.id ?? 'Blue'

  const playerRows = match.players.map((player) => ({
    player_name: player.riotId,
    agents: player.agent,
    side: player.team === teamAValorantSide ? 'a' : 'b',
    acs: player.acs,
    kills: player.kills,
    deaths: player.deaths,
    assists: player.assists,
    kd: player.kd,
    adr: player.adr,
    kast_pct: player.kastPct,
    fk: player.firstKills,
    fd: player.firstDeaths,
    hs_pct: player.hsPct,
    plants: player.plants,
    defuses: player.defuses,
    econ_rating: player.econRating,
    mk_2k: player.multiKills.k2,
    mk_3k: player.multiKills.k3,
    mk_4k: player.multiKills.k4,
    mk_5k: player.multiKills.k5,
    clutches_won: player.clutches.totalWon,
    clutches_attempted: player.clutches.attempted,
    // The per-size clutch breakdown has no columns of its own — a 1v1 and a
    // 1v5 are both wins in `clutches_won`, and the difference is worth keeping.
    metadata: {
      puuid: player.puuid,
      clutch_breakdown: player.clutches.won,
      // Keyed by opponent puuid; the UI joins it back to names via each row's
      // own `puuid` to build the head-to-head grid.
      duels: player.duels,
    },
  }))

  return {
    sourceFilename: `riot-${match.matchId}-map-${mapOrder}.json`,
    mapName: match.map,
    scheduledAt: match.startedAt,
    teamAName,
    teamBName,
    teamARounds: roundsFor(teamAValorantSide),
    teamBRounds: roundsFor(teamBValorantSide),
    playerRows,
  }
}
