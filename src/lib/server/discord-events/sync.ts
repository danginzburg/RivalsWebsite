import { env } from '$env/dynamic/private'
import { supabaseAdmin } from '$lib/supabase/admin'
import { resolveTargetSeasonId } from '$lib/server/seasons/resolve'
import { notifyMatchCancelled, notifyMatchScheduled } from '$lib/server/notifications/events'
import {
  createEvent,
  deleteEvent,
  discordConfig,
  getBotUserId,
  getEvent,
  listEvents,
  updateEvent,
  type DiscordConfig,
} from './api'
import {
  CREATE_WINDOW_MS,
  EventStatus,
  eventBodyForMatch,
  findMatchToAdopt,
  normalizeTwitchUrl,
  parseBestOf,
  parseMatchTitle,
  planLinked,
  shouldCreateEvent,
  snapshotAfterCreate,
  snapshotFromEvent,
  teamsKey,
  type DiscordAction,
  type DiscordEvent,
  type SiteChanges,
  type Snapshot,
  type SyncMatch,
  type SyncTeam,
} from './plan'

/**
 * Keeps each upcoming match and its Discord scheduled event in step. Site
 * edits call `syncMatchToDiscord` straight away; `runDiscordSync` runs every
 * minute (see docs/discord-bot.md) to pick up edits made in Discord, which
 * Discord only announces over a Gateway connection this site does not keep.
 */

type LinkRow = Snapshot & {
  guild_event_id: string
  guild_id: string
  match_id: string | null
  origin: 'site' | 'discord'
  closed_at: string | null
}

type StreamRow = { id: string; platform: string | null; stream_url: string; is_primary: boolean }

type MatchRow = {
  id: string
  status: string | null
  approval_status: string | null
  scheduled_at: string | null
  best_of: number | null
  team_a: SyncTeam | SyncTeam[] | null
  team_b: SyncTeam | SyncTeam[] | null
  match_streams: StreamRow[] | null
}

const MATCH_SELECT = `
  id, status, approval_status, scheduled_at, best_of,
  team_a:teams!matches_team_a_id_fkey (id, name, tag),
  team_b:teams!matches_team_b_id_fkey (id, name, tag),
  match_streams (id, platform, stream_url, is_primary)
`

const LINKS = 'discord_match_events'

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null
  return Array.isArray(rel) ? (rel[0] ?? null) : rel
}

/** The match's Twitch stream: the primary one if it is on Twitch, else the first. */
function twitchStream(row: MatchRow): StreamRow | null {
  const twitch = (row.match_streams ?? []).filter((s) => normalizeTwitchUrl(s.stream_url))
  return twitch.find((s) => s.is_primary) ?? twitch[0] ?? null
}

function toSyncMatch(row: MatchRow): SyncMatch {
  const stream = twitchStream(row)
  return {
    id: row.id,
    status: row.status,
    approval_status: row.approval_status,
    scheduled_at: row.scheduled_at,
    best_of: row.best_of,
    team_a: one(row.team_a),
    team_b: one(row.team_b),
    twitch_url: stream ? normalizeTwitchUrl(stream.stream_url) : null,
  }
}

/** Where event links point. Set SITE_URL so a preview deployment never links to itself. */
export function siteOrigin(requestOrigin: string): string {
  return env.SITE_URL?.trim().replace(/\/$/, '') || requestOrigin
}

async function loadMatches(ids: string[]): Promise<Map<string, MatchRow>> {
  if (ids.length === 0) return new Map()
  const { data, error } = await supabaseAdmin.from('matches').select(MATCH_SELECT).in('id', ids)
  if (error) throw new Error(`Failed to load matches: ${error.message}`)
  return new Map(((data ?? []) as unknown as MatchRow[]).map((row) => [row.id, row]))
}

function snapshotColumns(snapshot: Snapshot): Snapshot {
  return {
    site_start: snapshot.site_start,
    site_twitch_url: snapshot.site_twitch_url,
    site_teams_key: snapshot.site_teams_key,
    event_start: snapshot.event_start,
    event_location: snapshot.event_location,
  }
}

// ---------------------------------------------------------------------------
// Applying a plan

async function applySiteChanges(
  row: MatchRow,
  changes: SiteChanges,
  actorProfileId: string | null
): Promise<void> {
  if (changes.scheduledAt) {
    const { error } = await supabaseAdmin
      .from('matches')
      .update({ scheduled_at: changes.scheduledAt })
      .eq('id', row.id)
    if (error) throw new Error(`Failed to move match ${row.id}: ${error.message}`)
  }

  if (changes.twitchUrl !== undefined) {
    const current = twitchStream(row)
    if (changes.twitchUrl === null) {
      if (current) await supabaseAdmin.from('match_streams').delete().eq('id', current.id)
    } else if (current) {
      await supabaseAdmin
        .from('match_streams')
        .update({ stream_url: changes.twitchUrl })
        .eq('id', current.id)
    } else {
      const hasPrimary = (row.match_streams ?? []).some((s) => s.is_primary)
      await supabaseAdmin.from('match_streams').insert({
        match_id: row.id,
        platform: 'twitch',
        stream_url: changes.twitchUrl,
        status: 'scheduled',
        is_primary: !hasPrimary,
        metadata: { source: 'discord_event' },
      })
    }
  }

  if (changes.cancel) {
    const { error } = await supabaseAdmin
      .from('matches')
      .update({ status: 'cancelled' })
      .eq('id', row.id)
      .eq('status', 'scheduled')
    if (error) throw new Error(`Failed to cancel match ${row.id}: ${error.message}`)
    await notifyMatchCancelled(row.id, actorProfileId)
  } else if (changes.scheduledAt) {
    await notifyMatchScheduled(row.id, actorProfileId)
  }
}

async function applyDiscordAction(
  config: DiscordConfig,
  eventId: string,
  action: DiscordAction
): Promise<void> {
  if (action.type === 'update') await updateEvent(config, eventId, action.body)
  else if (action.type === 'delete') await deleteEvent(config, eventId)
}

async function reconcileLink(
  config: DiscordConfig,
  link: LinkRow,
  row: MatchRow | null,
  event: DiscordEvent | null,
  origin: string
): Promise<'updated' | 'closed' | 'unchanged'> {
  const plan = planLinked({
    match: row ? toSyncMatch(row) : null,
    event,
    snapshot: link,
    now: new Date(),
    origin,
  })

  if (row) await applySiteChanges(row, plan.site, null)
  await applyDiscordAction(config, link.guild_event_id, plan.discord)

  const changed =
    plan.close ||
    plan.discord.type !== 'none' ||
    Object.keys(plan.site).length > 0 ||
    JSON.stringify(snapshotColumns(plan.snapshot)) !== JSON.stringify(snapshotColumns(link))
  if (changed) {
    await supabaseAdmin
      .from(LINKS)
      .update({
        ...snapshotColumns(plan.snapshot),
        closed_at: plan.close ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('guild_event_id', link.guild_event_id)
  }
  if (plan.close) return 'closed'
  return changed ? 'updated' : 'unchanged'
}

async function createForMatch(config: DiscordConfig, row: MatchRow, origin: string) {
  const match = toSyncMatch(row)
  const body = eventBodyForMatch(match, origin)
  const created = await createEvent(config, body)
  const { error } = await supabaseAdmin.from(LINKS).insert({
    guild_event_id: created.id,
    guild_id: config.guildId,
    match_id: match.id,
    origin: 'site',
    ...snapshotAfterCreate(match, body),
  })
  if (error) {
    // Another run linked this match first (one open link per match): undo ours.
    await deleteEvent(config, created.id)
    if (error.code !== '23505') throw new Error(`Failed to link event: ${error.message}`)
  }
}

async function loadLinksForMatch(matchId: string): Promise<LinkRow[]> {
  const { data, error } = await supabaseAdmin.from(LINKS).select('*').eq('match_id', matchId)
  if (error) throw new Error(`Failed to load Discord links: ${error.message}`)
  return (data ?? []) as LinkRow[]
}

// ---------------------------------------------------------------------------
// Entry points

/**
 * Bring one match's Discord event up to date after a site edit: create it,
 * move it, rename it, or take it down. Never throws; a failure is logged and
 * the next scheduled run tries again.
 */
export async function syncMatchToDiscord(matchId: string, requestOrigin: string): Promise<void> {
  const config = discordConfig()
  if (!config) return
  try {
    const origin = siteOrigin(requestOrigin)
    const [rows, links] = await Promise.all([loadMatches([matchId]), loadLinksForMatch(matchId)])
    const row = rows.get(matchId) ?? null
    const open = links.find((l) => !l.closed_at)
    if (open) {
      const event = await getEvent(config, open.guild_event_id)
      await reconcileLink(config, open, row, event, origin)
      return
    }
    if (!row) return
    const closedStarts = links.map((l) => l.site_start)
    if (shouldCreateEvent(toSyncMatch(row), new Date(), closedStarts)) {
      await createForMatch(config, row, origin)
    }
  } catch (err) {
    console.error(`Discord event sync failed for match ${matchId}:`, err)
  }
}

/** Take a match's event down before the match itself is deleted. Never throws. */
export async function removeMatchFromDiscord(matchId: string, requestOrigin: string) {
  const config = discordConfig()
  if (!config) return
  try {
    const open = (await loadLinksForMatch(matchId)).find((l) => !l.closed_at)
    if (!open) return
    const event = await getEvent(config, open.guild_event_id)
    await reconcileLink(config, open, null, event, siteOrigin(requestOrigin))
  } catch (err) {
    console.error(`Discord event removal failed for match ${matchId}:`, err)
  }
}

export type SyncReport = {
  configured: boolean
  created: number
  updated: number
  closed: number
  imported: number
  adopted: number
  errors: string[]
}

/** Everything both ways: the scheduled run. */
export async function runDiscordSync(requestOrigin: string): Promise<SyncReport> {
  const report: SyncReport = {
    configured: false,
    created: 0,
    updated: 0,
    closed: 0,
    imported: 0,
    adopted: 0,
    errors: [],
  }
  const config = discordConfig()
  if (!config) return report
  report.configured = true
  const origin = siteOrigin(requestOrigin)
  const now = new Date()

  const [events, linksResult, upcomingResult] = await Promise.all([
    listEvents(config),
    supabaseAdmin.from(LINKS).select('*').eq('guild_id', config.guildId),
    supabaseAdmin
      .from('matches')
      .select('id')
      .eq('approval_status', 'approved')
      .eq('status', 'scheduled')
      .gt('scheduled_at', now.toISOString())
      .lt('scheduled_at', new Date(now.getTime() + CREATE_WINDOW_MS).toISOString()),
  ])
  if (linksResult.error)
    throw new Error(`Failed to load Discord links: ${linksResult.error.message}`)
  if (upcomingResult.error)
    throw new Error(`Failed to load matches: ${upcomingResult.error.message}`)

  const links = (linksResult.data ?? []) as LinkRow[]
  const open = links.filter((l) => !l.closed_at)
  const eventById = new Map(events.map((e) => [e.id, e]))
  const upcomingIds = (upcomingResult.data ?? []).map((m) => m.id as string)
  const rows = await loadMatches([
    ...new Set([...upcomingIds, ...open.map((l) => l.match_id).filter((id) => id != null)]),
  ])

  // 1. Linked pairs, both directions.
  for (const link of open) {
    try {
      // The list leaves out ended and cancelled events; ask for those by id.
      const event =
        eventById.get(link.guild_event_id) ?? (await getEvent(config, link.guild_event_id))
      const row = link.match_id ? (rows.get(link.match_id) ?? null) : null
      const outcome = await reconcileLink(config, link, row, event, origin)
      if (outcome === 'updated') report.updated++
      if (outcome === 'closed') report.closed++
    } catch (err) {
      report.errors.push(`event ${link.guild_event_id}: ${(err as Error).message}`)
    }
  }

  // 2. Upcoming matches with no event yet.
  const openMatchIds = new Set(open.map((l) => l.match_id))
  for (const id of upcomingIds) {
    const row = rows.get(id)
    if (!row || openMatchIds.has(id)) continue
    const closedStarts = links.filter((l) => l.match_id === id).map((l) => l.site_start)
    if (!shouldCreateEvent(toSyncMatch(row), now, closedStarts)) continue
    try {
      await createForMatch(config, row, origin)
      report.created++
    } catch (err) {
      report.errors.push(`match ${id}: ${(err as Error).message}`)
    }
  }

  // 3. Events someone made in Discord.
  const known = new Set(links.map((l) => l.guild_event_id))
  const botId = await getBotUserId(config)
  const handMade = events.filter(
    (e) => !known.has(e.id) && e.status === EventStatus.Scheduled && e.creator_id !== botId
  )
  if (handMade.length > 0) {
    const teams = await loadActiveSeasonTeams()
    for (const event of handMade) {
      try {
        const outcome = await importEvent(config, event, teams)
        if (outcome === 'imported') report.imported++
        if (outcome === 'adopted') report.adopted++
      } catch (err) {
        report.errors.push(`discord event ${event.id}: ${(err as Error).message}`)
      }
    }
  }

  return report
}

// ---------------------------------------------------------------------------
// Discord → site: new events

async function loadActiveSeasonTeams(): Promise<SyncTeam[]> {
  const seasonId = await resolveTargetSeasonId(undefined)
  if (!seasonId) return []
  const { data } = await supabaseAdmin
    .from('teams')
    .select('id, name, tag')
    .eq('season_id', seasonId)
    .eq('approval_status', 'approved')
  return (data ?? []) as SyncTeam[]
}

async function profileForDiscordUser(discordId: string | null | undefined): Promise<string | null> {
  if (!discordId) return null
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('discord_id', discordId)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

/**
 * An event titled "Team A vs Team B" becomes that match on the site, or is
 * attached to it if an admin already entered it. Titles that name no pair of
 * current-season teams are left alone.
 */
async function importEvent(
  config: DiscordConfig,
  event: DiscordEvent,
  teams: SyncTeam[]
): Promise<'imported' | 'adopted' | 'skipped'> {
  const pair = parseMatchTitle(event.name, teams)
  if (!pair) return 'skipped'

  const start = new Date(event.scheduled_start_time).getTime()
  const { data: nearby } = await supabaseAdmin
    .from('matches')
    .select('id')
    .eq('approval_status', 'approved')
    .in('status', ['scheduled', 'live'])
    .gte('scheduled_at', new Date(start - 12 * 3600_000).toISOString())
    .lte('scheduled_at', new Date(start + 12 * 3600_000).toISOString())
  const nearbyRows = await loadMatches((nearby ?? []).map((m) => m.id as string))
  const adopt = findMatchToAdopt(event, pair, [...nearbyRows.values()].map(toSyncMatch))
  const location = event.entity_metadata?.location ?? null
  const twitch = normalizeTwitchUrl(location)

  if (adopt) {
    const links = await loadLinksForMatch(adopt.id)
    // The site already made this match an event; leave the extra one alone.
    if (links.some((l) => !l.closed_at)) return 'skipped'
    const { error } = await supabaseAdmin.from(LINKS).insert({
      guild_event_id: event.id,
      guild_id: config.guildId,
      match_id: adopt.id,
      origin: 'discord',
      ...snapshotFromEvent(event, {
        scheduled_at: adopt.scheduled_at,
        twitch_url: adopt.twitch_url,
        teams_key: teamsKey(adopt),
      }),
    })
    if (error) throw new Error(`Failed to link event: ${error.message}`)
    return 'adopted'
  }

  const profileId = await profileForDiscordUser(event.creator_id)
  const seasonId = await resolveTargetSeasonId(undefined)
  const now = new Date().toISOString()
  const { data: created, error: createError } = await supabaseAdmin
    .from('matches')
    .insert({
      status: 'scheduled',
      approval_status: 'approved',
      best_of: parseBestOf(event.name, event.description),
      scheduled_at: new Date(event.scheduled_start_time).toISOString(),
      team_a_id: pair[0].id,
      team_b_id: pair[1].id,
      submitted_by_profile_id: profileId,
      approved_by_profile_id: profileId,
      approved_at: now,
      season_id: seasonId,
      metadata: { source: 'discord_event', discord_event_id: event.id },
    })
    .select('id, scheduled_at')
    .single()
  if (createError || !created) {
    throw new Error(`Failed to create match: ${createError?.message ?? 'no row'}`)
  }

  if (twitch) {
    await supabaseAdmin.from('match_streams').insert({
      match_id: created.id,
      platform: 'twitch',
      stream_url: twitch,
      status: 'scheduled',
      is_primary: true,
      metadata: { source: 'discord_event' },
    })
  }

  const { error: linkError } = await supabaseAdmin.from(LINKS).insert({
    guild_event_id: event.id,
    guild_id: config.guildId,
    match_id: created.id,
    origin: 'discord',
    ...snapshotFromEvent(event, {
      scheduled_at: created.scheduled_at as string,
      twitch_url: twitch,
      teams_key: `${pair[0].id}|${pair[1].id}`,
    }),
  })
  if (linkError) {
    // Another run imported it first; drop the duplicate match.
    await supabaseAdmin.from('matches').delete().eq('id', created.id)
    if (linkError.code !== '23505') throw new Error(`Failed to link event: ${linkError.message}`)
    return 'skipped'
  }

  await notifyMatchScheduled(created.id as string, profileId)
  return 'imported'
}
