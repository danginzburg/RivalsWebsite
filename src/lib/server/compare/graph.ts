import { supabaseAdmin } from '$lib/supabase/admin'
import { TtlCache } from '$lib/server/cache'
import { fetchAllRows } from '$lib/server/supabase/fetch-all'
import { loadIdentityIndex } from '$lib/server/players/identity'
import { resolveMatchStageKey } from '$lib/stats/sections'
import {
  normalizeRosterDates,
  type GraphMap,
  type GraphMapRow,
  type GraphMatch,
  type MatchGraph,
  type RosterSpot,
} from './compute'

type RawMapRow = Omit<GraphMapRow, 'profile_id'> & {
  id: number
  profile_id: string | null
  player_name: string | null
  puuid: string | null
}

const ROW_COLUMNS =
  'id, match_map_id, match_id, team_id, profile_id, player_name, puuid, rounds, acs, kills, deaths, assists, adr, kast_pct, hs_pct, fk, fd'

async function buildMatchGraph(): Promise<MatchGraph> {
  const [rawMatches, maps, rawRows, identity, rosters] = await Promise.all([
    fetchAllRows<Omit<GraphMatch, 'stage'> & { stage: string | null; designation: string | null }>(
      () =>
        supabaseAdmin
          .from('matches')
          .select(
            'id, season_id, team_a_id, team_b_id, winner_team_id, team_a_score, team_b_score, scheduled_at, stage, designation:metadata->>designation'
          )
          .eq('status', 'completed')
          .eq('approval_status', 'approved')
          .order('id')
    ),
    fetchAllRows<GraphMap & { is_voided: boolean | null }>(() =>
      supabaseAdmin
        .from('match_maps')
        .select('id, match_id, map_name, team_a_rounds, team_b_rounds, is_voided')
        .order('id')
    ),
    fetchAllRows<RawMapRow>(() =>
      supabaseAdmin.from('player_match_map_stats').select(ROW_COLUMNS).order('id')
    ),
    loadIdentityIndex(),
    fetchAllRows<RosterSpot>(() =>
      supabaseAdmin
        .from('team_memberships')
        .select('team_id, profile_id, joined_at, left_at')
        .not('profile_id', 'is', null)
        .order('id')
    ),
  ])

  // One stage key per match, read the same way the stats generator reads it.
  const matches: GraphMatch[] = rawMatches.map(({ designation, stage, ...m }) => ({
    ...m,
    stage: resolveMatchStageKey(stage, designation),
  }))

  const matchIds = new Set(matches.map((m) => m.id))
  const liveMaps = maps.filter((m) => !m.is_voided && matchIds.has(m.match_id))
  const mapIds = new Set(liveMaps.map((m) => m.id))

  // Rows imported before a player claimed their profile carry only a Riot
  // name or PUUID; resolve those the same way the rest of the site does.
  const rows: GraphMapRow[] = []
  for (const raw of rawRows) {
    if (!mapIds.has(raw.match_map_id)) continue
    const { id: _id, player_name, puuid, ...row } = raw
    rows.push({ ...row, profile_id: row.profile_id ?? identity.resolve(player_name, puuid) })
  }

  return {
    matches,
    maps: liveMaps.map(({ is_voided: _voided, ...map }) => map),
    rows,
    rosters: normalizeRosterDates(rosters, matches),
  }
}

/**
 * The whole league's match history in one object. A few thousand small rows
 * today; cached for five minutes so a burst of comparisons costs one load.
 */
const graphCache = new TtlCache<MatchGraph>({ ttlMs: 5 * 60_000, maxEntries: 1 })

export function loadMatchGraph(): Promise<MatchGraph> {
  return graphCache.wrap('all', buildMatchGraph)
}
