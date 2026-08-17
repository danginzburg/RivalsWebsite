import { error } from '@sveltejs/kit'

import {
  buildPickemSlots,
  isPickemLocked,
  normalizePickemFeed,
  normalizePickemFormat,
  normalizePickemPayload,
  normalizePickemSeeds,
  normalizePickemStatus,
  rankPickemLeaderboardEntries,
  scorePickemPayload,
  validatePickemPayload,
  type PickemEvent,
  type PickemFormat,
  type PickemLinkedResult,
  type PickemMatch,
  type PickemPayload,
  type PickemSeed,
  type PickemTeam,
} from '$lib/pickems'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { supabaseAdmin } from '$lib/supabase/admin'

type SeasonRow = { id: string; code: string; name: string }

type EventRow = {
  id: string
  season_id: string
  format: string
  title: string
  status: string
  lock_at: string | null
  config: unknown
}

type MatchRow = {
  slot_key: string
  group_key: string
  sort_order: number
  label: string
  points: number
  team_a_id: string | null
  team_b_id: string | null
  feed_a: unknown
  feed_b: unknown
  linked_match_id: string | null
  actual_winner_id: string | null
}

type TeamRow = { id: string; name: string; tag: string | null; logo_path?: string | null }

const EVENT_COLUMNS = 'id, season_id, format, title, status, lock_at, config'
const MATCH_COLUMNS =
  'slot_key, group_key, sort_order, label, points, team_a_id, team_b_id, feed_a, feed_b, linked_match_id, actual_winner_id'

export type PickemContext = {
  season: SeasonRow
  event: PickemEvent | null
  matches: PickemMatch[]
  teams: PickemTeam[]
}

export type PickemPublicSubmission = {
  id: string
  score: number
  scoredAt: string | null
  submittedAt: string
  payload: PickemPayload
  user: { id: string | null; name: string }
}

export type PickemLeaderboardEntry = PickemPublicSubmission & { rank: number }

export type PickemScoreSummary = {
  eventId: string
  submissionsScored: number
  scoredAt: string
  completedMatches: number
}

function toEvent(row: EventRow): PickemEvent {
  const config =
    row.config && typeof row.config === 'object' ? (row.config as Record<string, unknown>) : {}
  return {
    id: row.id,
    seasonId: row.season_id,
    format: normalizePickemFormat(row.format),
    title: row.title ?? '',
    status: normalizePickemStatus(row.status),
    lockAt: row.lock_at,
    seeds: normalizePickemSeeds(config.seeds),
  }
}

function toMatch(row: MatchRow): PickemMatch {
  return {
    slotKey: row.slot_key,
    groupKey: row.group_key ?? '',
    sortOrder: row.sort_order ?? 0,
    label: row.label ?? '',
    points: row.points ?? 1,
    teamAId: row.team_a_id,
    teamBId: row.team_b_id,
    feedA: normalizePickemFeed(row.feed_a),
    feedB: normalizePickemFeed(row.feed_b),
    linkedMatchId: row.linked_match_id,
    actualWinnerId: row.actual_winner_id,
  }
}

function normalizeTeam(team: TeamRow): PickemTeam {
  return { id: team.id, name: team.name, tag: team.tag ?? null, logo_url: getTeamLogoUrl(team) }
}

function profileName(profile: { display_name: string | null; email: string | null } | null) {
  return profile?.display_name?.trim() || profile?.email?.trim() || 'User'
}

/**
 * Fetch and normalize teams by id. Used to backfill teams a linked real match
 * references but the pick'em's seeds/assigned slots do not — otherwise those
 * show as "Unknown team".
 */
export async function getPickemTeamsByIds(ids: string[]): Promise<PickemTeam[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  if (unique.length === 0) return []
  const { data, error: teamsError } = await supabaseAdmin
    .from('teams')
    .select('id, name, tag, logo_path')
    .in('id', unique)
  if (teamsError) throw error(500, 'Failed to load pick’em teams')
  return (data ?? []).map((team: TeamRow) => normalizeTeam(team))
}

/** Every team id a bracket's seeds or a matchup's slots reference, seeds first. */
function involvedTeamIds(event: PickemEvent, matches: PickemMatch[]): string[] {
  const ids: string[] = []
  for (const seed of event.seeds) ids.push(seed.teamId)
  for (const match of matches) {
    if (match.teamAId) ids.push(match.teamAId)
    if (match.teamBId) ids.push(match.teamBId)
  }
  return Array.from(new Set(ids))
}

async function loadContext(season: SeasonRow): Promise<PickemContext> {
  const { data: eventRow, error: eventError } = await supabaseAdmin
    .from('pickem_events')
    .select(EVENT_COLUMNS)
    .eq('season_id', season.id)
    .maybeSingle()

  if (eventError) throw error(500, 'Failed to load pick’em')
  if (!eventRow) return { season, event: null, matches: [], teams: [] }

  const event = toEvent(eventRow as EventRow)

  const { data: matchRows, error: matchError } = await supabaseAdmin
    .from('pickem_matches')
    .select(MATCH_COLUMNS)
    .eq('event_id', event.id)
    .order('sort_order', { ascending: true })

  if (matchError) throw error(500, 'Failed to load pick’em matches')
  const matches = (matchRows ?? []).map((row) => toMatch(row as MatchRow))

  const teamIds = involvedTeamIds(event, matches)
  let teams: PickemTeam[] = []
  if (teamIds.length > 0) {
    const { data, error: teamsError } = await supabaseAdmin
      .from('teams')
      .select('id, name, tag, logo_path')
      .in('id', teamIds)
    if (teamsError) throw error(500, 'Failed to load pick’em teams')
    const byId = new Map((data ?? []).map((team: TeamRow) => [team.id, normalizeTeam(team)]))
    // Seed order first so a bracket's team list reads 1..N, then any extras.
    teams = teamIds.map((id) => byId.get(id)).filter((team): team is PickemTeam => Boolean(team))
  }

  return { season, event, matches, teams }
}

async function getSeasonBy(column: 'code' | 'id', value: string): Promise<SeasonRow> {
  const { data: season, error: seasonError } = await supabaseAdmin
    .from('seasons')
    .select('id, code, name')
    .eq(column, value)
    .maybeSingle()
  if (seasonError || !season) throw error(404, 'Season not found')
  return season as SeasonRow
}

export async function getPickemContextBySeasonCode(seasonCode: string): Promise<PickemContext> {
  return loadContext(await getSeasonBy('code', seasonCode))
}

export async function getPickemContextBySeasonId(seasonId: string): Promise<PickemContext> {
  return loadContext(await getSeasonBy('id', seasonId))
}

// ---------------------------------------------------------------------------
// Admin: save an event + its matches for a season.
// ---------------------------------------------------------------------------

export type SavePickemInput = {
  format?: unknown
  title?: unknown
  status?: unknown
  lockAt?: unknown
  seeds?: unknown
  matches?: unknown
}

function normalizeMatchInput(value: unknown, index: number): MatchRow {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const slotKey =
    typeof raw.slotKey === 'string' && raw.slotKey.trim() ? raw.slotKey.trim() : `m_${index}`
  const asId = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return {
    slot_key: slotKey,
    group_key: typeof raw.groupKey === 'string' ? raw.groupKey : '',
    sort_order: Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : index,
    label: typeof raw.label === 'string' ? raw.label : slotKey,
    points: Number.isFinite(Number(raw.points)) ? Math.max(0, Math.trunc(Number(raw.points))) : 1,
    team_a_id: asId(raw.teamAId),
    team_b_id: asId(raw.teamBId),
    feed_a: normalizePickemFeed(raw.feedA),
    feed_b: normalizePickemFeed(raw.feedB),
    linked_match_id: asId(raw.linkedMatchId),
    actual_winner_id: asId(raw.actualWinnerId),
  }
}

export async function savePickemForSeason(
  seasonId: string,
  input: SavePickemInput
): Promise<PickemContext> {
  const season = await getSeasonBy('id', seasonId)

  const format: PickemFormat = normalizePickemFormat(input.format)
  const seeds: PickemSeed[] = normalizePickemSeeds(input.seeds)
  const status = normalizePickemStatus(input.status)
  const lockAt =
    typeof input.lockAt === 'string' && input.lockAt.trim() ? input.lockAt.trim() : null
  const title = typeof input.title === 'string' ? input.title : season.name

  const matchInputs = Array.isArray(input.matches) ? input.matches : []
  const matchRows = matchInputs.map((m, i) => normalizeMatchInput(m, i))

  const slotKeys = new Set<string>()
  for (const row of matchRows) {
    if (slotKeys.has(row.slot_key)) throw error(400, `Duplicate match key "${row.slot_key}"`)
    slotKeys.add(row.slot_key)
  }

  const { data: eventRow, error: upsertError } = await supabaseAdmin
    .from('pickem_events')
    .upsert(
      {
        season_id: seasonId,
        format,
        title,
        status,
        lock_at: lockAt,
        config: { seeds },
      },
      { onConflict: 'season_id' }
    )
    .select(EVENT_COLUMNS)
    .single()

  if (upsertError || !eventRow) throw error(500, 'Failed to save pick’em')
  const eventId = (eventRow as EventRow).id

  // Replace the match set wholesale — the admin editor always sends the full
  // list, and a diff-based update would leak rows removed in the UI.
  const { error: deleteError } = await supabaseAdmin
    .from('pickem_matches')
    .delete()
    .eq('event_id', eventId)
  if (deleteError) throw error(500, 'Failed to save pick’em matches')

  if (matchRows.length > 0) {
    const { error: insertError } = await supabaseAdmin
      .from('pickem_matches')
      .insert(matchRows.map((row) => ({ ...row, event_id: eventId })))
    if (insertError) throw error(500, 'Failed to save pick’em matches')
  }

  return loadContext(season)
}

// ---------------------------------------------------------------------------
// Submissions.
// ---------------------------------------------------------------------------

export async function getPickemSubmissionForProfile(eventId: string, profileId: string) {
  const { data, error: submissionError } = await supabaseAdmin
    .from('pickem_submissions')
    .select(
      'id, event_id, season_id, profile_id, kind, payload, score, scored_at, created_at, updated_at'
    )
    .eq('event_id', eventId)
    .eq('profile_id', profileId)
    .maybeSingle()

  if (submissionError) throw error(500, 'Failed to load pick’em submission')
  if (!data) return null
  return { ...data, payload: normalizePickemPayload(data.payload) }
}

export async function upsertPickemSubmission(input: {
  seasonId: string
  profileId: string
  payload: unknown
}) {
  const context = await getPickemContextBySeasonId(input.seasonId)
  const { event, matches } = context
  if (!event || event.status !== 'open') throw error(400, "Pick'em is not open")
  if (isPickemLocked(event)) throw error(400, "Pick'em is locked")

  const slotKeys = matches.map((m) => m.slotKey)
  let payload: PickemPayload
  try {
    payload = validatePickemPayload(event, matches, normalizePickemPayload(input.payload, slotKeys))
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Invalid pick’em submission')
  }

  const { data, error: upsertError } = await supabaseAdmin
    .from('pickem_submissions')
    .upsert(
      {
        event_id: event.id,
        season_id: event.seasonId,
        profile_id: input.profileId,
        kind: event.format,
        payload,
        score: 0,
        scored_at: null,
      },
      { onConflict: 'season_id,profile_id,kind' }
    )
    .select(
      'id, event_id, season_id, profile_id, kind, payload, score, scored_at, created_at, updated_at'
    )
    .single()

  if (upsertError) throw error(500, 'Failed to save pick’em submission')
  return { ...data, payload: normalizePickemPayload(data.payload) }
}

export async function listPickemPublicSubmissions(
  eventId: string
): Promise<PickemPublicSubmission[]> {
  const { data, error: listError } = await supabaseAdmin
    .from('pickem_submissions')
    .select(
      'id, created_at, score, scored_at, payload, profiles!pickem_submissions_profile_id_fkey (id, display_name, email)'
    )
    .eq('event_id', eventId)

  if (listError) throw error(500, 'Failed to load pick’em submissions')

  return (data ?? []).map(
    (row: {
      id: string
      created_at: string
      score: number
      scored_at: string | null
      payload: unknown
      profiles:
        | { id: string | null; display_name: string | null; email: string | null }
        | { id: string | null; display_name: string | null; email: string | null }[]
        | null
    }) => {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
      return {
        id: row.id,
        score: row.score,
        scoredAt: row.scored_at,
        submittedAt: row.created_at,
        payload: normalizePickemPayload(row.payload),
        user: { id: profile?.id ?? null, name: profileName(profile ?? null) },
      }
    }
  )
}

export async function listPickemLeaderboard(eventId: string): Promise<PickemLeaderboardEntry[]> {
  return rankPickemLeaderboardEntries(await listPickemPublicSubmissions(eventId))
}

// ---------------------------------------------------------------------------
// Linked real matches.
// ---------------------------------------------------------------------------

/** Winners of completed linked matches, keyed by slot key — the scoreable results. */
export async function getActualWinnersFromLinkedMatches(
  matches: PickemMatch[]
): Promise<Record<string, string>> {
  const linked = matches.filter((m) => m.linkedMatchId)
  const winners: Record<string, string> = {}
  if (linked.length === 0) return winners

  const { data, error: matchesError } = await supabaseAdmin
    .from('matches')
    .select('id, status, winner_team_id')
    .in(
      'id',
      linked.map((m) => m.linkedMatchId!)
    )

  if (matchesError) throw error(500, 'Failed to load linked pick’em matches')
  const byId = new Map(
    (data ?? []).map((m: { id: string; status: string | null; winner_team_id: string | null }) => [
      m.id,
      m,
    ])
  )
  for (const match of linked) {
    const real = byId.get(match.linkedMatchId!)
    if (real?.status === 'completed' && real.winner_team_id) {
      winners[match.slotKey] = real.winner_team_id
    }
  }
  return winners
}

/**
 * Teams and winner of each slot's linked real match — the source of truth when
 * a bracket is reconstructed after the fact (see PickemLinkedResult).
 */
export async function getLinkedResults(
  matches: PickemMatch[]
): Promise<Record<string, PickemLinkedResult>> {
  const linked = matches.filter((m) => m.linkedMatchId)
  const results: Record<string, PickemLinkedResult> = {}
  if (linked.length === 0) return results

  const { data, error: matchesError } = await supabaseAdmin
    .from('matches')
    .select('id, team_a_id, team_b_id, winner_team_id')
    .in(
      'id',
      linked.map((m) => m.linkedMatchId!)
    )

  if (matchesError) throw error(500, 'Failed to load linked pick’em matches')
  const byId = new Map(
    (data ?? []).map(
      (m: {
        id: string
        team_a_id: string | null
        team_b_id: string | null
        winner_team_id: string | null
      }) => [m.id, m]
    )
  )
  for (const match of linked) {
    const real = byId.get(match.linkedMatchId!)
    if (!real) continue
    results[match.slotKey] = {
      teamAId: real.team_a_id ?? null,
      teamBId: real.team_b_id ?? null,
      winnerId: real.winner_team_id ?? null,
    }
  }
  return results
}

export async function scorePickemSubmissionsForEvent(
  seasonId: string
): Promise<PickemScoreSummary> {
  const { event, matches } = await getPickemContextBySeasonId(seasonId)
  if (!event) throw error(400, "Pick'em is not set up for this season")
  if (!isPickemLocked(event)) throw error(400, "Pick'em must be locked before scoring")

  const actualWinners = await getActualWinnersFromLinkedMatches(matches)
  const scoredAt = new Date().toISOString()

  const { data: submissions, error: listError } = await supabaseAdmin
    .from('pickem_submissions')
    .select('id, payload')
    .eq('event_id', event.id)

  if (listError) throw error(500, 'Failed to load pick’em submissions')

  let submissionsScored = 0
  for (const submission of submissions ?? []) {
    const result = scorePickemPayload(
      matches,
      normalizePickemPayload(submission.payload),
      actualWinners
    )
    const { error: updateError } = await supabaseAdmin
      .from('pickem_submissions')
      .update({ score: result.score, scored_at: scoredAt })
      .eq('id', submission.id)
    if (updateError) throw error(500, 'Failed to update pick’em score')
    submissionsScored += 1
  }

  return {
    eventId: event.id,
    submissionsScored,
    scoredAt,
    completedMatches: Object.keys(actualWinners).length,
  }
}

/** Bracket seeds for a season, keyed by team id — used site-wide for seed labels. */
export async function getSeasonSeedMap(seasonId: string): Promise<Record<string, number>> {
  const { data, error: seedError } = await supabaseAdmin
    .from('pickem_events')
    .select('config')
    .eq('season_id', seasonId)
    .maybeSingle()
  if (seedError || !data) return {}
  const config =
    data.config && typeof data.config === 'object' ? (data.config as Record<string, unknown>) : {}
  const map: Record<string, number> = {}
  for (const seed of normalizePickemSeeds(config.seeds)) map[seed.teamId] = seed.seed
  return map
}

export { buildPickemSlots }
