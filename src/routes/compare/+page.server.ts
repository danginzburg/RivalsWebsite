import type { PageServerLoad } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'
import { loadSearchIndex } from '$lib/server/search'
import { loadMatchGraph } from '$lib/server/compare/graph'
import {
  comparePlayers,
  compareTeams,
  scopeGraph,
  type GraphScope,
} from '$lib/server/compare/compute'
import { loadPickerBatches, type PickerBatch } from '$lib/server/stats/picker-batches'
import { MATCH_STAGES, resolveBatchSection, sectionLabel } from '$lib/stats/sections'
import { loadTeamHistory } from '$lib/server/players/team-history'
import { loadSeasonFinalPlacements } from '$lib/server/seasons/finalPlacements'
import { summarizeHonors, type Finish, type PlayerHonors } from '$lib/server/compare/honors'
import { parseCompareIds, parseCompareKind } from '$lib/compare'
import { joinDescription, type PageMeta } from '$lib/meta'

/**
 * Link preview for a comparison: who is in it, and for two of them their
 * series record against each other.
 */
function compareMeta(
  kind: 'players' | 'teams',
  entities: CompareEntity[],
  series: { won: number; lost: number } | null,
  extra: Array<string | null>
): PageMeta {
  const noun = kind === 'teams' ? 'teams' : 'players'
  if (entities.length < 2) {
    return { title: kind === 'teams' ? 'Compare teams' : 'Compare players' }
  }
  const [a, b] = entities
  const record =
    entities.length === 2 && series && series.won + series.lost > 0
      ? `Head to head: ${a!.name} ${series.won}–${series.lost} ${b!.name}`
      : null
  return {
    title: entities.map((e) => e.name).join(' vs '),
    description: joinDescription([
      record,
      ...extra,
      `${entities.length} ${noun} compared side by side`,
    ]),
    image: entities.find((e) => e.imageUrl)?.imageUrl ?? null,
  }
}

export type CompareEntity = {
  id: string
  name: string
  subtitle: string | null
  imageUrl: string | null
  tag: string | null
}

/** A `rivals_group_stats` row as /api/stats returns it; only the columns the table shows are typed. */
export type StatsRow = {
  profile_id: string | null
  player_name: string | null
  games: number | null
  games_won: number | null
  games_lost: number | null
  rounds: number | null
  acs: number | null
  kd: number | null
  kast_pct: number | null
  adr: number | null
  hs_pct: number | null
  kpr: number | null
  apr: number | null
  fk: number | null
  fd: number | null
  fkpg: number | null
  fdpg: number | null
  kills: number | null
  deaths: number | null
  assists: number | null
  clutches_won: number | null
  clutches_attempted: number | null
}

function nameKey(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

const MATCH_STAGE_KEYS = new Set<string>(MATCH_STAGES.map((s) => s.key))

/**
 * The matches a stats table covers, so head-to-head follows the picker: All
 * Time is every Rivals season (the All Time table leaves external events out,
 * so head-to-head does too), a season's table is that season, and a single
 * phase (Kickoff, Playoffs…) is that stage of it.
 */
function scopeForBatch(
  batch: PickerBatch | undefined,
  seasons: Array<{ id: string; name: string | null; kind: string | null }>
): { scope: GraphScope; label: string } {
  const allRivals = {
    scope: { seasonIds: seasons.filter((s) => s.kind !== 'external').map((s) => s.id) },
    label: 'All Rivals seasons',
  }
  if (!batch) return allRivals
  const section = resolveBatchSection(batch)
  if (section === 'alltime' || resolveBatchSection({ display_name: batch.event }) === 'alltime') {
    return allRivals
  }
  // The picker tidies whitespace when naming events ("Season  2" is stored with
  // two spaces), so compare the same way.
  const norm = (value: string | null | undefined) =>
    String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  const event = norm(batch.event)
  const season =
    seasons.find((s) => norm(s.name) === event) ??
    seasons.find((s) => norm(s.name) === event.replace(/\s*\([^)]*\)$/, ''))
  // A table for an event with no season of its own has no matches here; say
  // so rather than quietly showing every season.
  if (!season) return { scope: { seasonIds: [] }, label: batch.event }
  const stage = MATCH_STAGE_KEYS.has(section) ? section : null
  return {
    scope: { seasonIds: [season.id], stage },
    label: stage ? `${season.name} · ${sectionLabel(stage)}` : (season.name ?? batch.event),
  }
}

export const load: PageServerLoad = async ({ url, fetch }) => {
  const kind = parseCompareKind(url.searchParams.get('type'))
  const requestedIds = parseCompareIds(url.searchParams.get('ids'))
  const index = await loadSearchIndex()

  if (kind === 'teams') {
    const teamById = new Map(index.teams.map((t) => [t.id, t]))
    const teams = requestedIds.map((id) => teamById.get(id)).filter((t) => t != null)
    const entities: CompareEntity[] = teams.map((t) => ({
      id: t.id,
      name: t.name,
      subtitle: t.season,
      imageUrl: t.logoUrl,
      tag: t.tag,
    }))

    const result =
      teams.length >= 2
        ? compareTeams(
            entities.map((e) => e.id),
            await loadMatchGraph()
          )
        : null

    // Each team's final finish in its season (null until the season is over).
    const finishes: Record<string, Finish | null> = {}
    if (teams.length >= 2) {
      const { data: seasonRows } = await supabaseAdmin
        .from('teams')
        .select('id, season_id')
        .in(
          'id',
          teams.map((t) => t.id)
        )
      const seasonByTeam = new Map(
        (seasonRows ?? []).map((r) => [r.id as string, r.season_id as string | null])
      )
      const seasonIds = [...new Set([...seasonByTeam.values()].filter((id) => id != null))]
      const finals = new Map(
        await Promise.all(
          seasonIds.map(async (id) => [id, await loadSeasonFinalPlacements(id)] as const)
        )
      )
      for (const team of teams) {
        const final = finals.get(seasonByTeam.get(team.id) ?? '')
        const p = final?.finished ? final.placements[team.id] : undefined
        finishes[team.id] = p && final ? { start: p.start, end: p.end, of: final.teamCount } : null
      }
    }
    const meta = compareMeta(kind, entities, result?.pairs[0]?.series ?? null, [])
    return {
      meta,
      kind,
      entities,
      teams: result ? { ...result, finishes } : null,
      players: null,
    }
  }

  const playerById = new Map(index.players.map((p) => [p.id, p]))
  const players = requestedIds.map((id) => playerById.get(id)).filter((p) => p != null)
  const entities: CompareEntity[] = players.map((p) => ({
    id: p.id,
    name: p.name,
    subtitle: p.team ? `${p.team}${p.teamSeason ? ` · ${p.teamSeason}` : ''}` : null,
    imageUrl: p.avatarUrl,
    tag: null,
  }))

  const picker = await loadPickerBatches()
  const requestedBatch = url.searchParams.get('batchId')
  const batchId =
    requestedBatch && picker.batches.some((b) => b.id === requestedBatch)
      ? requestedBatch
      : picker.allTimeBatchId

  if (players.length < 2) {
    return {
      meta: compareMeta(kind, entities, null, []),
      kind,
      entities,
      teams: null,
      players: {
        batchId,
        batches: picker.batches,
        events: picker.events,
        stats: {},
        pairs: [],
        teamNames: {},
        scopeLabel: 'All Rivals seasons',
        honors: {},
        multiSeason: true,
      },
    }
  }

  const [statsBody, graph] = await Promise.all([
    fetch(`/api/stats?limit=500${batchId ? `&batchId=${encodeURIComponent(batchId)}` : ''}`)
      .then((res) => res.json())
      .catch(() => ({ rows: [] })) as Promise<{ batchId?: string | null; rows?: StatsRow[] }>,
    loadMatchGraph(),
  ])

  // Each player's row in the chosen table: by profile, else by any Riot ID
  // they own (rows imported before they claimed their profile carry only the name).
  const rows = statsBody.rows ?? []
  // Clutches are only recorded from Season 5's Riot imports. Older tables carry
  // nulls, and a summed Full Season table turns those into zeros, so judge by
  // the whole table: if nobody ever attempted a clutch, it was not tracked.
  const clutchesTracked = rows.some((r) => (r.clutches_attempted ?? 0) > 0)
  const stats: Record<string, StatsRow | null> = {}
  for (const player of players) {
    const names = new Set(player.riotIds.flatMap((id) => [nameKey(id), nameKey(id.split('#')[0])]))
    const row =
      rows.find((r) => r.profile_id === player.id) ??
      rows.find((r) => !r.profile_id && names.has(nameKey(r.player_name))) ??
      null
    stats[player.id] =
      row && !clutchesTracked ? { ...row, clutches_won: null, clutches_attempted: null } : row
  }

  const effectiveBatchId = statsBody.batchId ?? batchId
  const picked = scopeForBatch(
    picker.batches.find((b) => b.id === effectiveBatchId),
    picker.seasons
  )
  let { scope, label: scopeLabel } = picked
  // Most older matches were never filed under a stage. A phase filter would
  // then show almost nothing, so widen to the whole season and say so.
  const seasonId = scope.seasonIds?.length === 1 ? scope.seasonIds[0] : null
  if (scope.stage && seasonId) {
    const untagged = graph.matches.some((m) => m.season_id === seasonId && !m.stage)
    if (untagged) {
      const seasonName = picker.seasons.find((s) => s.id === seasonId)?.name ?? 'this season'
      scope = { seasonIds: [seasonId] }
      scopeLabel = `${seasonName}, all stages (matches aren't tagged by stage)`
    }
  }
  const { pairs } = comparePlayers(
    entities.map((e) => e.id),
    scopeGraph(graph, scope)
  )

  // Finishes, titles and MVPs over the same seasons as the rest of the page.
  const honorSeasons =
    scope.seasonIds ?? picker.seasons.filter((s) => s.kind !== 'external').map((s) => s.id)
  const histories = await Promise.all(players.map((p) => loadTeamHistory(p.id)))
  const honors: Record<string, PlayerHonors> = {}
  players.forEach((p, i) => (honors[p.id] = summarizeHonors(histories[i]!, honorSeasons)))

  // Team names for the "met in" match lists.
  const meetingTeamIds = [
    ...new Set(
      pairs.flatMap((p) => p.meetings.flatMap((m) => [m.teamA, m.teamB])).filter((id) => id != null)
    ),
  ]
  const teamNames: Record<string, string> = {}
  if (meetingTeamIds.length > 0) {
    const { data } = await supabaseAdmin.from('teams').select('id, name').in('id', meetingTeamIds)
    for (const team of data ?? []) teamNames[team.id as string] = team.name as string
  }

  return {
    meta: compareMeta(kind, entities, pairs[0]?.againstSeries ?? null, [scopeLabel]),
    kind,
    entities,
    teams: null,
    players: {
      batchId: effectiveBatchId,
      batches: picker.batches,
      events: picker.events,
      stats,
      pairs,
      teamNames,
      scopeLabel,
      honors,
      multiSeason: honorSeasons.length !== 1,
    },
  }
}
