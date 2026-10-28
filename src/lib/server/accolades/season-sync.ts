import { isPickemComplete, rankPickemLeaderboardEntries } from '$lib/pickems'
import { supabaseAdmin } from '$lib/supabase/admin'
import { fetchAllRows } from '$lib/server/supabase/fetch-all'
import { createNotification } from '$lib/server/notifications'
import {
  getPickemResults,
  getPublishedPickemContextBySeasonId,
  listPickemPublicSubmissions,
} from '$lib/server/pickems'
import { loadSeasonThirdPlaceTeamIds } from '$lib/server/seasons/thirdPlace'
import { isShortStint } from '$lib/server/matches/subs'
import {
  planAccoladeSync,
  seasonContextLabel,
  type AwardDismissal,
  type ExistingAssignment,
  type SeasonAward,
} from '$lib/server/accolades/season-plan'

/**
 * Season accolades assigned from the results a season records, instead of by
 * hand:
 *
 *   1st / 2nd Place  - everyone on `seasons.winner_team_id` / `runner_up_team_id`
 *   3rd Place        - `seasons.third_place_team_id`, else the bracket's 3rd (thirdPlace.ts)
 *   Finals MVP       - `seasons.mvp_profile_id`
 *   Pick'em Champion - the top scorer(s) of the season's finished pick'em
 *
 * A team's players are its roster for that season plus anyone who played a map
 * for it, less anyone whose only stint on the roster was closed (they left).
 * Each player is matched to a profile through the roster row, their PUUID, or a
 * Riot ID / name that only one profile answers to; anyone who cannot be matched
 * is skipped and picked up by a later sync once their account is linked.
 *
 * Rows the sync writes are `source = 'auto'`. It never touches manual rows, and
 * an automatic row an admin removes is remembered in `accolade_auto_dismissals`.
 */

type AwardKind = 'first' | 'second' | 'third' | 'mvp' | 'pickem'

/** How each award's accolade is found: by preset icon, preferring the seeded name. */
const AWARD_ACCOLADES: Record<AwardKind, { iconKeys: string[]; name: RegExp }> = {
  first: { iconKeys: ['gold_medal'], name: /^1st place$/i },
  second: { iconKeys: ['silver_medal'], name: /^2nd place$/i },
  third: { iconKeys: ['bronze_medal'], name: /^3rd place$/i },
  mvp: { iconKeys: ['mvp_trophy', 'trophy'], name: /\bmvp\b/i },
  pickem: { iconKeys: ['pickem_medal'], name: /pick.?em/i },
}

type AccoladeRow = { id: string; name: string; icon_key: string | null; created_at: string }

type SeasonRow = {
  id: string
  name: string | null
  code: string | null
  winner_team_id: string | null
  runner_up_team_id: string | null
  mvp_profile_id: string | null
}

type RosterSource = { profile_id: string | null; puuid: string | null; player_name: string | null }

export type SeasonAccoladeSyncResult = {
  seasonsChecked: number
  added: SeasonAward[]
  removed: number
  /** Roster or stat names no profile could be matched to, per season. */
  unmatched: Record<string, string[]>
}

function resolveAwardAccolades(accolades: AccoladeRow[]): Partial<Record<AwardKind, string>> {
  const byKind: Partial<Record<AwardKind, string>> = {}
  for (const [kind, rule] of Object.entries(AWARD_ACCOLADES) as Array<
    [AwardKind, (typeof AWARD_ACCOLADES)[AwardKind]]
  >) {
    const candidates = accolades
      .filter((a) => a.icon_key && rule.iconKeys.includes(a.icon_key))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
    const pick = candidates.find((a) => rule.name.test(a.name.trim())) ?? candidates[0]
    if (pick) byKind[kind] = pick.id
  }
  return byKind
}

const nameKey = (value: string | null | undefined) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

/**
 * Matches roster and stat rows to profiles. A PUUID or full Riot ID is taken
 * as given; a bare name only counts when exactly one profile answers to it, so
 * two players sharing a handle are never confused.
 */
async function loadProfileResolver() {
  const [accounts, profiles] = await Promise.all([
    fetchAllRows<{
      profile_id: string
      riot_name: string | null
      riot_tag: string | null
      puuid: string | null
    }>(() =>
      supabaseAdmin
        .from('riot_accounts')
        .select('profile_id, riot_name, riot_tag, puuid')
        .not('profile_id', 'is', null)
        .eq('status', 'approved')
        .order('id')
    ),
    fetchAllRows<{ id: string; display_name: string | null }>(() =>
      supabaseAdmin.from('profiles').select('id, display_name').order('id')
    ),
  ])

  const byPuuid = new Map<string, string>()
  const byName = new Map<string, Set<string>>()
  const addName = (key: string, profileId: string) => {
    if (!key) return
    const owners = byName.get(key) ?? new Set<string>()
    owners.add(profileId)
    byName.set(key, owners)
  }
  for (const a of accounts) {
    if (a.puuid) byPuuid.set(a.puuid, a.profile_id)
    addName(nameKey(a.riot_name), a.profile_id)
    if (a.riot_name && a.riot_tag) addName(nameKey(`${a.riot_name}#${a.riot_tag}`), a.profile_id)
  }
  for (const p of profiles) addName(nameKey(p.display_name), p.id)

  return (row: RosterSource): string | null => {
    if (row.profile_id) return row.profile_id
    if (row.puuid && byPuuid.has(row.puuid)) return byPuuid.get(row.puuid)!
    const owners = byName.get(nameKey(row.player_name))
    return owners && owners.size === 1 ? [...owners][0]! : null
  }
}

type Resolver = Awaited<ReturnType<typeof loadProfileResolver>>

/** Profiles that played for a team in its season; names left unmatched go to `unmatched`. */
async function loadTeamPlayers(
  teamId: string,
  resolve: Resolver,
  unmatched: Set<string>
): Promise<Set<string>> {
  const [{ data: memberships, error: membershipError }, maps] = await Promise.all([
    supabaseAdmin
      .from('team_memberships')
      .select('profile_id, puuid, player_name, is_active, joined_at, left_at')
      .eq('team_id', teamId),
    fetchAllRows<RosterSource & { id: string }>(() =>
      supabaseAdmin
        .from('player_match_map_stats')
        .select('id, profile_id, puuid, player_name')
        .eq('team_id', teamId)
        .order('id')
    ),
  ])
  if (membershipError) throw new Error(`Failed to load roster for team ${teamId}`)

  const onRoster = new Set<string>()
  const leftRoster = new Set<string>()
  for (const m of memberships ?? []) {
    if (isShortStint(m.joined_at, m.left_at)) continue
    const profileId = resolve(m)
    if (!profileId) {
      if (m.player_name) unmatched.add(m.player_name)
      continue
    }
    if (m.is_active && !m.left_at) onRoster.add(profileId)
    else leftRoster.add(profileId)
  }

  const players = new Set(onRoster)
  for (const row of maps) {
    const profileId = resolve(row)
    if (!profileId) {
      if (row.player_name) unmatched.add(row.player_name)
      continue
    }
    // Someone who played and then left the roster did not finish with the team.
    if (leftRoster.has(profileId) && !onRoster.has(profileId)) continue
    players.add(profileId)
  }
  return players
}

/** Top scorer(s) of the season's pick'em, once every result is in. */
async function loadPickemChampions(seasonId: string): Promise<string[]> {
  const ctx = await getPublishedPickemContextBySeasonId(seasonId)
  if (!ctx.event || ctx.matches.length === 0) return []
  const { actualWinners } = await getPickemResults(ctx.event, ctx.matches)
  if (!isPickemComplete(ctx.matches, actualWinners)) return []
  const submissions = await listPickemPublicSubmissions(ctx.event.id, ctx.matches, actualWinners)
  return rankPickemLeaderboardEntries(submissions)
    .filter((s) => s.rank === 1 && s.score > 0 && s.user.id)
    .map((s) => s.user.id!)
}

async function computeSeasonAwards(
  season: SeasonRow,
  accoladeFor: Partial<Record<AwardKind, string>>,
  resolve: Resolver
): Promise<{ awards: SeasonAward[]; unmatched: string[] }> {
  const context = seasonContextLabel(season)
  const awards: SeasonAward[] = []
  const unmatched = new Set<string>()
  const award = (kind: AwardKind, profileIds: Iterable<string>) => {
    const accoladeId = accoladeFor[kind]
    if (!accoladeId) return
    for (const profileId of profileIds) {
      awards.push({ accoladeId, profileId, seasonId: season.id, context })
    }
  }

  // The winner is only filled in once a season is over; until then the
  // placements are not settled.
  if (season.winner_team_id) {
    award('first', await loadTeamPlayers(season.winner_team_id, resolve, unmatched))
    if (season.runner_up_team_id) {
      award('second', await loadTeamPlayers(season.runner_up_team_id, resolve, unmatched))
    }
    const placed = new Set([season.winner_team_id, season.runner_up_team_id])
    for (const teamId of await loadSeasonThirdPlaceTeamIds(season.id)) {
      if (placed.has(teamId)) continue
      award('third', await loadTeamPlayers(teamId, resolve, unmatched))
    }
  }

  if (season.mvp_profile_id) award('mvp', [season.mvp_profile_id])

  try {
    award('pickem', await loadPickemChampions(season.id))
  } catch (err) {
    console.error("Failed to resolve pick'em champions for season", season.id, err)
  }

  return { awards, unmatched: [...unmatched].sort() }
}

/**
 * The awards each season's results call for (all seasons, or just `seasonIds`),
 * without comparing them to what is already assigned.
 */
export async function loadSeasonAwards(seasonIdFilter?: string[]): Promise<{
  seasonIds: string[]
  desired: SeasonAward[]
  unmatched: Record<string, string[]>
  accolades: AccoladeRow[]
}> {
  let seasonQuery = supabaseAdmin
    .from('seasons')
    .select('id, name, code, winner_team_id, runner_up_team_id, mvp_profile_id')
  if (seasonIdFilter) seasonQuery = seasonQuery.in('id', seasonIdFilter)

  const [{ data: seasons, error: seasonError }, { data: accolades, error: accoladeError }] =
    await Promise.all([
      seasonQuery,
      supabaseAdmin.from('accolades').select('id, name, icon_key, created_at'),
    ])
  if (seasonError) throw new Error('Failed to load seasons')
  if (accoladeError) throw new Error('Failed to load accolades')

  const seasonRows = (seasons ?? []) as SeasonRow[]
  const accoladeRows = (accolades ?? []) as AccoladeRow[]
  const desired: SeasonAward[] = []
  const unmatched: Record<string, string[]> = {}
  if (seasonRows.length > 0) {
    const accoladeFor = resolveAwardAccolades(accoladeRows)
    const resolve = await loadProfileResolver()
    for (const season of seasonRows) {
      const computed = await computeSeasonAwards(season, accoladeFor, resolve)
      desired.push(...computed.awards)
      if (computed.unmatched.length > 0) unmatched[seasonContextLabel(season)] = computed.unmatched
    }
  }

  return { seasonIds: seasonRows.map((s) => s.id), desired, unmatched, accolades: accoladeRows }
}

/**
 * Bring automatic season accolades in line with season results.
 *
 * `seasonIds` limits the sync to those seasons (default: every season);
 * `profileId` limits it to one player, for after their account is linked.
 * `notify` sends the usual "You earned an accolade" notification for each new
 * award; `dryRun` computes the changes without writing them.
 */
export async function syncSeasonAccolades(
  opts: {
    seasonIds?: string[]
    profileId?: string | null
    notify?: boolean
    dryRun?: boolean
  } = {}
): Promise<SeasonAccoladeSyncResult> {
  const { notify = true, dryRun = false } = opts
  const { seasonIds, desired, unmatched, accolades } = await loadSeasonAwards(opts.seasonIds)
  const result: SeasonAccoladeSyncResult = {
    seasonsChecked: seasonIds.length,
    added: [],
    removed: 0,
    unmatched,
  }
  if (seasonIds.length === 0) return result

  // Every season's labels, so a hand-typed "Season 3" context matches its season.
  const [{ data: allSeasons }, existing, dismissed] = await Promise.all([
    supabaseAdmin.from('seasons').select('id, name, code'),
    fetchAllRows<ExistingAssignment>(() => {
      let q = supabaseAdmin
        .from('accolade_assignments')
        .select('id, accolade_id, profile_id, season_id, context, source')
        .order('id')
      if (opts.profileId) q = q.eq('profile_id', opts.profileId)
      return q
    }),
    fetchAllRows<AwardDismissal>(() =>
      supabaseAdmin
        .from('accolade_auto_dismissals')
        .select('accolade_id, profile_id, season_id')
        .in('season_id', seasonIds)
        .order('created_at')
    ),
  ])

  const plan = planAccoladeSync({
    desired,
    existing,
    dismissed,
    seasons: allSeasons ?? [],
    scope: { seasonIds, profileId: opts.profileId ?? null },
  })
  result.added = plan.insert
  result.removed = plan.remove.length
  if (dryRun) return result

  if (plan.remove.length > 0) {
    const { error: deleteError } = await supabaseAdmin
      .from('accolade_assignments')
      .delete()
      .in(
        'id',
        plan.remove.map((r) => r.id)
      )
    if (deleteError) throw new Error('Failed to remove outdated season accolades')
  }

  if (plan.insert.length > 0) {
    const { error: insertError } = await supabaseAdmin.from('accolade_assignments').insert(
      plan.insert.map((a) => ({
        accolade_id: a.accoladeId,
        profile_id: a.profileId,
        season_id: a.seasonId,
        context: a.context,
        source: 'auto',
      }))
    )
    if (insertError) throw new Error('Failed to add season accolades')

    if (notify) {
      const names = new Map(((accolades ?? []) as AccoladeRow[]).map((a) => [a.id, a.name]))
      for (const a of plan.insert) {
        const name = names.get(a.accoladeId)
        await createNotification({
          recipientProfileId: a.profileId,
          type: 'accolade_awarded',
          title: name ? `You earned an accolade: ${name}` : 'You earned an accolade',
          body: a.context,
          link: `/players/${a.profileId}`,
          entityType: 'accolade',
          entityId: a.accoladeId,
        })
      }
    }
  }

  return result
}

/**
 * `syncSeasonAccolades` for call sites where awarding accolades is a side
 * effect: a failure is logged, never thrown, so it cannot fail the save that
 * triggered it.
 */
export async function syncSeasonAccoladesSafely(
  opts: Parameters<typeof syncSeasonAccolades>[0]
): Promise<void> {
  try {
    await syncSeasonAccolades(opts)
  } catch (err) {
    console.error('Season accolade sync failed:', err)
  }
}
