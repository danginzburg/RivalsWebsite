import { supabaseAdmin } from '$lib/supabase/admin'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { siteUrl, webhookOptions, webhookUrlFor } from './config'
import { teamRosterPayload, teamUpdatePayload, type RosterTeam } from './embeds'
import { deletePost, upsertPost, type UpsertResult } from './posts'
import {
  diffRosters,
  displayName,
  normalizeRole,
  parseChanges,
  parseRoster,
  sortRoster,
  type RosterChange,
  type RosterEntry,
} from './roster-diff'

/*
 * Roster announcements, published by an admin rather than on every edit.
 *
 * Editing a roster posts nothing. The admin page shows the difference between
 * the live roster and the last published one (team_roster_announcements), and
 * publishing it:
 *   - the first time, posts the team to #team-creation with its roster;
 *   - after that, posts the changes to #team-updates and edits the
 *     #team-creation post: current roster plus a dated change history.
 * "Correct last" re-does the newest publish against the live roster, editing
 * both posts instead of sending new ones.
 */

const ROSTER_KIND = 'team_roster'
const UPDATE_KIND = 'team_update'

type AnnouncementRow = {
  id: string
  kind: 'initial' | 'update'
  previousId: string | null
  roster: RosterEntry[]
  changes: RosterChange[]
  createdAt: string
}

export type RosterState = {
  teamId: string
  team: RosterTeam
  seasonActive: boolean
  current: RosterEntry[]
  rows: AnnouncementRow[]
  /** What publishing now would announce; empty when nothing changed. */
  pending: RosterChange[]
  /** The first publish announces the team instead of posting an update. */
  announced: boolean
}

export class RosterPublishError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

type SeasonRel = { name: string | null; is_active: boolean | null }
const one = <T>(rel: T | T[] | null | undefined): T | null =>
  Array.isArray(rel) ? (rel[0] ?? null) : (rel ?? null)

async function loadCurrentRoster(teamId: string): Promise<RosterEntry[]> {
  const { data, error } = await supabaseAdmin
    .from('team_memberships')
    .select('profile_id, puuid, player_name, role, profiles (display_name)')
    .eq('team_id', teamId)
    .eq('is_active', true)
    .is('left_at', null)
  if (error) throw new RosterPublishError('Failed to load the roster', 500)
  return sortRoster(
    (data ?? []).map((m) => {
      const profile = one(m.profiles as unknown as { display_name: string | null } | null)
      const playerName = (m.player_name as string | null) ?? null
      return {
        name: displayName(playerName, profile?.display_name ?? null),
        role: normalizeRole(m.role),
        profileId: (m.profile_id as string | null) ?? null,
        puuid: (m.puuid as string | null) ?? null,
        nameKey: (playerName ?? '').trim().toLowerCase(),
      }
    })
  )
}

async function loadRows(teamId: string): Promise<AnnouncementRow[]> {
  const { data, error } = await supabaseAdmin
    .from('team_roster_announcements')
    .select('id, kind, previous_id, roster, changes, created_at')
    .eq('team_id', teamId)
    .order('created_at', { ascending: true })
  if (error) throw new RosterPublishError('Failed to load published rosters', 500)
  return (data ?? []).map((r) => ({
    id: r.id as string,
    kind: r.kind === 'initial' ? 'initial' : 'update',
    previousId: (r.previous_id as string | null) ?? null,
    roster: parseRoster(r.roster),
    changes: parseChanges(r.changes),
    createdAt: r.created_at as string,
  }))
}

export async function loadRosterState(teamId: string): Promise<RosterState> {
  const { data: team, error } = await supabaseAdmin
    .from('teams')
    .select('id, name, tag, logo_path, season:seasons!teams_season_id_fkey (name, is_active)')
    .eq('id', teamId)
    .maybeSingle()
  if (error) throw new RosterPublishError('Failed to load the team', 500)
  if (!team) throw new RosterPublishError('Team not found', 404)
  const season = one(team.season as SeasonRel | SeasonRel[] | null)

  const [current, rows] = await Promise.all([loadCurrentRoster(teamId), loadRows(teamId)])
  const last = rows.at(-1) ?? null
  return {
    teamId,
    team: {
      name: team.name as string,
      tag: (team.tag as string | null) ?? null,
      logoUrl: getTeamLogoUrl(team),
      seasonName: season?.name ?? null,
      teamUrl: `${siteUrl()}/teams/${teamId}`,
    },
    seasonActive: Boolean(season?.is_active),
    current,
    rows,
    pending: last ? diffRosters(last.roster, current) : [],
    announced: Boolean(last),
  }
}

/** The #team-creation post: newest roster, history of every published update. */
function creationPayload(state: RosterState, rows: AnnouncementRow[]) {
  const last = rows.at(-1)
  const history = rows
    .filter((r) => r.kind === 'update')
    .map((r) => ({ at: r.createdAt, changes: r.changes }))
  return teamRosterPayload(state.team, last?.roster ?? [], history)
}

function channelUrls() {
  const creation = webhookUrlFor('team_creation')
  const updates = webhookUrlFor('team_updates')
  return { creation, updates }
}

/** Refuse anything that would post nowhere or to the wrong season. */
function assertCanPost(state: RosterState) {
  if (!state.seasonActive) {
    throw new RosterPublishError('Only teams in the active season post to Discord', 409)
  }
  const { creation, updates } = channelUrls()
  if (!creation) throw new RosterPublishError('WEBHOOK_TEAM_CREATION is not set', 503)
  if (state.announced && !updates) {
    throw new RosterPublishError('WEBHOOK_TEAM_UPDATES is not set', 503)
  }
}

async function postCreation(state: RosterState, rows: AnnouncementRow[]): Promise<UpsertResult> {
  const url = channelUrls().creation
  if (!url) return 'skipped'
  return upsertPost(
    { kind: ROSTER_KIND, subjectId: state.teamId, channel: 'team_creation' },
    url,
    creationPayload(state, rows),
    webhookOptions()
  )
}

async function postUpdate(
  state: RosterState,
  row: AnnouncementRow,
  mode: 'upsert' | 'edit'
): Promise<UpsertResult> {
  const url = channelUrls().updates
  if (!url) return 'skipped'
  return upsertPost(
    { kind: UPDATE_KIND, subjectId: row.id, channel: 'team_updates' },
    url,
    teamUpdatePayload(state.team, row.changes, row.createdAt),
    { ...webhookOptions(), mode }
  )
}

export type PublishResult = {
  kind: 'initial' | 'update'
  changes: RosterChange[]
  /** False when the #team-creation post could not be edited (the update still went out). */
  creationPosted: boolean
}

/** Publish the pending roster: announce the team, or post an update. */
export async function publishRoster(
  teamId: string,
  adminProfileId: string
): Promise<PublishResult> {
  const state = await loadRosterState(teamId)
  assertCanPost(state)
  const last = state.rows.at(-1) ?? null
  if (last && state.pending.length === 0) {
    throw new RosterPublishError('Nothing has changed since the last publish', 409)
  }
  if (!last && state.current.length === 0) {
    throw new RosterPublishError('Add players before announcing the team', 409)
  }

  const kind = last ? 'update' : 'initial'
  const { data: inserted, error } = await supabaseAdmin
    .from('team_roster_announcements')
    .insert({
      team_id: teamId,
      previous_id: last?.id ?? null,
      kind,
      roster: state.current,
      changes: state.pending,
      published_by: adminProfileId,
    })
    .select('id, created_at')
    .single()
  if (error?.code === '23505') {
    throw new RosterPublishError('Someone else just published this roster; refresh', 409)
  }
  if (error || !inserted) throw new RosterPublishError('Failed to save the publish', 500)

  const row: AnnouncementRow = {
    id: inserted.id as string,
    kind,
    previousId: last?.id ?? null,
    roster: state.current,
    changes: state.pending,
    createdAt: inserted.created_at as string,
  }
  const rows = [...state.rows, row]

  if (kind === 'update') {
    const sent = await postUpdate(state, row, 'upsert')
    if (sent === 'failed' || sent === 'skipped') {
      // Nothing reached Discord: undo, so the changes stay pending.
      await supabaseAdmin.from('team_roster_announcements').delete().eq('id', row.id)
      throw new RosterPublishError('Discord did not accept the update; try again', 502)
    }
  }

  const creation = await postCreation(state, rows)
  if (kind === 'initial' && (creation === 'failed' || creation === 'skipped')) {
    await supabaseAdmin.from('team_roster_announcements').delete().eq('id', row.id)
    throw new RosterPublishError('Discord did not accept the team post; try again', 502)
  }

  return {
    kind,
    changes: row.changes,
    creationPosted: creation === 'posted' || creation === 'edited',
  }
}

export type CorrectResult = {
  /** 'edited': the last publish now matches the roster. 'withdrawn': it undid itself and was deleted. */
  outcome: 'edited' | 'withdrawn'
  changes: RosterChange[]
}

/**
 * Re-do the newest publish against the live roster, editing its posts. When
 * the corrected update no longer changes anything, its #team-updates post is
 * deleted and it drops out of the history.
 */
export async function correctLastPublish(
  teamId: string,
  adminProfileId: string
): Promise<CorrectResult> {
  const state = await loadRosterState(teamId)
  assertCanPost(state)
  const last = state.rows.at(-1)
  if (!last) throw new RosterPublishError('Nothing has been published yet', 409)
  if (state.pending.length === 0) {
    throw new RosterPublishError('The last publish already matches the roster', 409)
  }

  const previous = state.rows.at(-2) ?? null
  const changes =
    last.kind === 'update' && previous ? diffRosters(previous.roster, state.current) : []

  // Discord first, the database after: a refused edit leaves the correction
  // pending, so the admin sees the failure and can try again.
  const notAccepted = (r: UpsertResult) => r === 'failed' || r === 'skipped'

  if (last.kind === 'update' && changes.length === 0) {
    const url = channelUrls().updates
    const deleted =
      !url ||
      (await deletePost(
        { kind: UPDATE_KIND, subjectId: last.id, channel: 'team_updates' },
        url,
        webhookOptions()
      ))
    if (!deleted) {
      throw new RosterPublishError('Discord did not delete the last update; try again', 502)
    }
    await supabaseAdmin.from('team_roster_announcements').delete().eq('id', last.id)
    if (notAccepted(await postCreation(state, state.rows.slice(0, -1)))) {
      throw new RosterPublishError(
        'The update was withdrawn, but the #team-creation post could not be edited',
        502
      )
    }
    return { outcome: 'withdrawn', changes: [] }
  }

  const corrected: AnnouncementRow = { ...last, roster: state.current, changes }
  const rows = [...state.rows.slice(0, -1), corrected]
  if (corrected.kind === 'update' && (await postUpdate(state, corrected, 'edit')) === 'failed') {
    throw new RosterPublishError('Discord did not accept the edit; try again', 502)
  }
  if (notAccepted(await postCreation(state, rows))) {
    throw new RosterPublishError('Discord did not accept the #team-creation edit; try again', 502)
  }

  const { error } = await supabaseAdmin
    .from('team_roster_announcements')
    .update({
      roster: state.current,
      changes,
      published_by: adminProfileId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', last.id)
  if (error) throw new RosterPublishError('Discord was corrected, but saving it failed', 500)
  return { outcome: 'edited', changes }
}

/** For the admin panel: the pending diff and the payloads publishing would send. */
export async function rosterPreview(teamId: string) {
  const state = await loadRosterState(teamId)
  const last = state.rows.at(-1) ?? null
  const { creation, updates } = channelUrls()
  const now = new Date().toISOString()
  const nextRows: AnnouncementRow[] = [
    ...state.rows,
    {
      id: 'preview',
      kind: last ? 'update' : 'initial',
      previousId: last?.id ?? null,
      roster: state.current,
      changes: state.pending,
      createdAt: now,
    },
  ]
  return {
    announced: state.announced,
    seasonActive: state.seasonActive,
    channels: { creation: Boolean(creation), updates: Boolean(updates) },
    current: state.current,
    pending: state.pending,
    lastPublishedAt: last?.createdAt ?? null,
    lastChanges: last?.changes ?? [],
    updateCount: state.rows.filter((r) => r.kind === 'update').length,
    preview: {
      update:
        last && state.pending.length > 0 ? teamUpdatePayload(state.team, state.pending, now) : null,
      creation: creationPayload(state, nextRows),
    },
  }
}
