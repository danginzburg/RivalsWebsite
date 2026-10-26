import { error } from '@sveltejs/kit'

import {
  DE8_TOP_SEEDS,
  buildPickemSlots,
  isPickemLocked,
  normalizePickemFeed,
  normalizePickemFormat,
  normalizePickemPayload,
  normalizePickemSeeds,
  normalizePickemStatus,
  resolvePickemResults,
  scorePickemPayload,
  standardDoubleElim8Template,
  validatePickemPayload,
  type PickemEvent,
  type PickemFormat,
  type PickemMatch,
  type PickemPayload,
  type PickemRealMatch,
  type PickemResults,
  type PickemSeed,
  type PickemTeam,
} from '$lib/pickems'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { resolveMatchStageKey } from '$lib/stats/sections'
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
  submittedAt: string
  payload: PickemPayload
  user: { id: string | null; name: string }
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

/**
 * The season's pick'em as the public sees it: a draft event is an admin
 * work-in-progress, so its bracket and seeds are treated as not there.
 */
export async function getPublishedPickemContextBySeasonId(
  seasonId: string
): Promise<PickemContext> {
  const ctx = await getPickemContextBySeasonId(seasonId)
  if (ctx.event?.status !== 'draft') return ctx
  return { season: ctx.season, event: null, matches: [], teams: [] }
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
  /** Bracket only: seed (1–4) → the team that seed picked to face. */
  opponents?: unknown
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

/**
 * A bracket is always the standard template — the admin only supplies the top
 * four seeds and the opponent each one picked. Per-slot overrides (a manual
 * link or a pre-decided winner) carry over from the posted rows by slot key.
 */
function buildBracket(
  input: SavePickemInput,
  status: string
): { seeds: PickemSeed[]; rows: MatchRow[] } {
  const topSeeds: readonly number[] = DE8_TOP_SEEDS
  const seeds = normalizePickemSeeds(input.seeds).filter((s) => topSeeds.includes(s.seed))
  const rawOpponents =
    input.opponents && typeof input.opponents === 'object'
      ? (input.opponents as Record<string, unknown>)
      : {}
  const opponents: Record<number, string | null> = {}
  for (const seed of DE8_TOP_SEEDS) {
    const value = rawOpponents[seed]
    opponents[seed] = typeof value === 'string' && value.trim() ? value.trim() : null
  }

  const teamIds = [...seeds.map((s) => s.teamId), ...Object.values(opponents)].filter(Boolean)
  if (new Set(teamIds).size !== teamIds.length) {
    throw error(400, 'A team can only appear once in the bracket')
  }
  if (status !== 'draft' && teamIds.length < 8) {
    throw error(400, 'Pick the top 4 seeds and each one’s opponent before opening the pick’em')
  }

  const overrides = new Map(
    (Array.isArray(input.matches) ? input.matches : []).map((m, i) => {
      const row = normalizeMatchInput(m, i)
      return [row.slot_key, row]
    })
  )
  const rows = standardDoubleElim8Template(opponents).map((m) => ({
    slot_key: m.slotKey,
    group_key: m.groupKey,
    sort_order: m.sortOrder,
    label: m.label,
    points: m.points,
    team_a_id: m.teamAId,
    team_b_id: m.teamBId,
    feed_a: m.feedA,
    feed_b: m.feedB,
    linked_match_id: overrides.get(m.slotKey)?.linked_match_id ?? null,
    actual_winner_id: overrides.get(m.slotKey)?.actual_winner_id ?? null,
  }))
  return { seeds, rows }
}

export async function savePickemForSeason(
  seasonId: string,
  input: SavePickemInput
): Promise<PickemContext> {
  const season = await getSeasonBy('id', seasonId)

  const format: PickemFormat = normalizePickemFormat(input.format)
  const status = normalizePickemStatus(input.status)
  const lockAt =
    typeof input.lockAt === 'string' && input.lockAt.trim() ? input.lockAt.trim() : null
  const title = typeof input.title === 'string' ? input.title : season.name

  let seeds: PickemSeed[] = []
  let matchRows: MatchRow[]
  if (format === 'bracket') {
    ;({ seeds, rows: matchRows } = buildBracket(input, status))
  } else {
    const matchInputs = Array.isArray(input.matches) ? input.matches : []
    matchRows = matchInputs.map((m, i) => normalizeMatchInput(m, i))
  }

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

/**
 * Every submission, scored live against the results known right now — there is
 * no separate scoring step to run.
 */
export async function listPickemPublicSubmissions(
  eventId: string,
  matches: PickemMatch[],
  actualWinners: Record<string, string>
): Promise<PickemPublicSubmission[]> {
  const { data, error: listError } = await supabaseAdmin
    .from('pickem_submissions')
    .select(
      'id, created_at, payload, profiles!pickem_submissions_profile_id_fkey (id, display_name, email)'
    )
    .eq('event_id', eventId)

  if (listError) throw error(500, 'Failed to load pick’em submissions')

  return (data ?? []).map(
    (row: {
      id: string
      created_at: string
      payload: unknown
      profiles:
        | { id: string | null; display_name: string | null; email: string | null }
        | { id: string | null; display_name: string | null; email: string | null }[]
        | null
    }) => {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
      const payload = normalizePickemPayload(row.payload)
      return {
        id: row.id,
        score: scorePickemPayload(matches, payload, actualWinners).score,
        submittedAt: row.created_at,
        payload,
        user: { id: profile?.id ?? null, name: profileName(profile ?? null) },
      }
    }
  )
}

// ---------------------------------------------------------------------------
// Real results.
// ---------------------------------------------------------------------------

type RealMatchRow = {
  id: string
  status: string | null
  team_a_id: string
  team_b_id: string
  winner_team_id: string | null
  scheduled_at: string | null
  created_at: string
  stage: string | null
  metadata: Record<string, unknown> | null
}

const REAL_MATCH_COLUMNS =
  'id, status, team_a_id, team_b_id, winner_team_id, scheduled_at, created_at, stage, metadata'

function toRealMatch(row: RealMatchRow): PickemRealMatch {
  return {
    id: row.id,
    teamAId: row.team_a_id,
    teamBId: row.team_b_id,
    winnerId: row.winner_team_id,
    completed: row.status === 'completed',
  }
}

/**
 * Real matches that can decide a unit on their own, oldest first. A bracket
 * reads the season's playoff matches; anything unfiled counts too once it is
 * played after the lock. Weekly matchups read whatever was played after the
 * lock, or the whole season when there is no lock time.
 */
function isCandidate(event: PickemEvent, row: RealMatchRow): boolean {
  if (row.status === 'cancelled') return false
  const afterLock = !event.lockAt || (row.scheduled_at != null && row.scheduled_at >= event.lockAt)
  if (event.format === 'matchups') return afterLock
  const stage = resolveMatchStageKey(row.stage, row.metadata?.designation)
  if (stage === 'playoffs') return true
  return stage === null && Boolean(event.lockAt) && afterLock
}

/**
 * Every unit's real result: its manually linked match when it has one,
 * otherwise the match between its two teams (see `resolvePickemResults`).
 */
export async function getPickemResults(
  event: PickemEvent,
  matches: PickemMatch[]
): Promise<PickemResults> {
  const linkedIds = matches.map((m) => m.linkedMatchId).filter((id): id is string => Boolean(id))

  const [seasonRows, linkedRows] = await Promise.all([
    supabaseAdmin
      .from('matches')
      .select(REAL_MATCH_COLUMNS)
      .eq('season_id', event.seasonId)
      .neq('approval_status', 'rejected'),
    linkedIds.length > 0
      ? supabaseAdmin.from('matches').select(REAL_MATCH_COLUMNS).in('id', linkedIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (seasonRows.error || linkedRows.error) throw error(500, 'Failed to load pick’em results')

  const time = (row: RealMatchRow) => new Date(row.scheduled_at ?? row.created_at).getTime()
  const candidates = ((seasonRows.data ?? []) as RealMatchRow[])
    .filter((row) => isCandidate(event, row))
    .sort((a, b) => time(a) - time(b))
    .map(toRealMatch)
  const linked = Object.fromEntries(
    ((linkedRows.data ?? []) as RealMatchRow[]).map((row) => [row.id, toRealMatch(row)])
  )

  return resolvePickemResults(event, matches, { linked, candidates })
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
