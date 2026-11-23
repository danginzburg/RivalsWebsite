import { supabaseAdmin } from '$lib/supabase/admin'
import { TtlCache } from '$lib/server/cache'
import { fetchAllRows } from '$lib/server/supabase/fetch-all'
import { loadPlayerDirectory } from '$lib/server/players/directory'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import type { SearchIndex, SearchPlayer, SearchTeam } from '$lib/search'

type SeasonRel = {
  code: string | null
  name: string | null
  starts_on: string | null
  kind: string | null
}

type TeamRow = {
  id: string
  name: string
  tag: string | null
  logo_path: string | null
  /** Only selected on the membership embed; the team query filters on it. */
  approval_status?: string | null
  seasons: SeasonRel | SeasonRel[] | null
}

type MembershipRow = {
  profile_id: string | null
  teams: TeamRow | TeamRow[] | null
}

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null
  return Array.isArray(rel) ? (rel[0] ?? null) : rel
}

/** Season label for a result line: its display name ("Rivals Season 4"), else its code. */
function seasonLabel(season: SeasonRel | null): string | null {
  return season?.name?.trim() || season?.code?.trim() || null
}

const TEAM_COLUMNS = `
  id, name, tag, logo_path,
  seasons!teams_season_id_fkey (code, name, starts_on, kind)
`

async function buildSearchIndex(): Promise<SearchIndex> {
  const [directory, teamRows, membershipRows] = await Promise.all([
    loadPlayerDirectory(),
    fetchAllRows<TeamRow>(() =>
      supabaseAdmin.from('teams').select(TEAM_COLUMNS).eq('approval_status', 'approved').order('id')
    ),
    fetchAllRows<MembershipRow>(() =>
      supabaseAdmin
        .from('team_memberships')
        .select(
          `profile_id, teams (id, name, tag, logo_path, approval_status, seasons!teams_season_id_fkey (code, name, starts_on, kind))`
        )
        .not('profile_id', 'is', null)
        .order('id')
    ),
  ])

  // Each player's most recent team, for the result's subtitle: the latest
  // Rivals season wins over any external event (hidden by default), then the
  // latest start date. Profiles with a membership are searchable even before
  // they link a Riot account.
  const latestTeam = new Map<string, { team: TeamRow; rank: string }>()
  for (const row of membershipRows) {
    const team = one(row.teams)
    if (!row.profile_id || !team || team.approval_status !== 'approved') continue
    const season = one(team.seasons)
    const rank = `${season?.kind === 'external' ? 0 : 1}|${season?.starts_on ?? ''}`
    const current = latestTeam.get(row.profile_id)
    if (!current || rank > current.rank) latestTeam.set(row.profile_id, { team, rank })
  }

  const players: SearchPlayer[] = []
  for (const entry of directory.values()) {
    const hasTeam = latestTeam.has(entry.profile_id)
    // Signed-in visitors who never linked a Riot account or joined a team
    // are not players, so keep them out of the results.
    if (!hasTeam && entry.riot_ids.length === 0) continue

    const primaryRiotId = entry.riot_name
      ? entry.riot_tag
        ? `${entry.riot_name}#${entry.riot_tag}`
        : entry.riot_name
      : null
    const name = entry.display_name?.trim() || primaryRiotId || entry.riot_ids[0]
    if (!name) continue

    const team = latestTeam.get(entry.profile_id)?.team ?? null
    players.push({
      id: entry.profile_id,
      name,
      riotIds: entry.riot_ids,
      avatarUrl: entry.avatar_url,
      team: team ? team.name : null,
      teamSeason: team ? seasonLabel(one(team.seasons)) : null,
    })
  }

  const teams: SearchTeam[] = teamRows.map((team) => {
    const season = one(team.seasons)
    return {
      id: team.id,
      name: team.name,
      tag: team.tag,
      logoUrl: getTeamLogoUrl(team),
      season: seasonLabel(season),
      seasonStartsOn: season?.starts_on ?? null,
      external: season?.kind === 'external',
    }
  })

  players.sort((a, b) => a.name.localeCompare(b.name))
  // Newest season first, so the current incarnation of a recurring name wins ties.
  teams.sort((a, b) => (b.seasonStartsOn ?? '').localeCompare(a.seasonStartsOn ?? ''))

  return { players, teams }
}

/**
 * Small enough to build whole and filter in the browser. Rosters and names
 * change a few times a week, so five minutes of staleness is fine.
 */
const searchIndexCache = new TtlCache<SearchIndex>({ ttlMs: 5 * 60_000, maxEntries: 1 })

export function loadSearchIndex(): Promise<SearchIndex> {
  return searchIndexCache.wrap('all', buildSearchIndex)
}
