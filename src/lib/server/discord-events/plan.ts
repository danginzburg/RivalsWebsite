/**
 * Two-way sync between matches and Discord scheduled events: the pure part.
 *
 * Each linked pair keeps a snapshot of what both sides looked like at the last
 * sync. Comparing each side to the snapshot tells which one changed since, so
 * an edit made in Discord flows to the site and an edit made on the site flows
 * to Discord. When both changed the same field, Discord wins: it is the more
 * recent hand edit, since site edits are pushed the moment they are saved.
 */

/** Discord's `GUILD_SCHEDULED_EVENT_STATUS`. */
export const EventStatus = { Scheduled: 1, Active: 2, Completed: 3, Canceled: 4 } as const

/** An event hosted outside Discord, with a free-text location (the stream link). */
const ENTITY_TYPE_EXTERNAL = 3
const PRIVACY_GUILD_ONLY = 2

/** Events are created this far ahead; later matches get theirs as the date nears. */
export const CREATE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

/** A matched event and site match this far apart are taken to be the same fixture. */
const ADOPT_WINDOW_MS = 12 * 60 * 60 * 1000

export type SyncTeam = { id: string; name: string; tag?: string | null }

/** The match fields the sync reads. */
export type SyncMatch = {
  id: string
  status: string | null
  approval_status: string | null
  scheduled_at: string | null
  best_of: number | null
  team_a: SyncTeam | null
  team_b: SyncTeam | null
  /** The match's Twitch stream, if it has one. */
  twitch_url: string | null
}

export type DiscordEvent = {
  id: string
  guild_id: string
  name: string
  description?: string | null
  scheduled_start_time: string
  scheduled_end_time?: string | null
  status: number
  entity_type: number
  entity_metadata?: { location?: string | null } | null
  creator_id?: string | null
}

export type EventBody = {
  name?: string
  description?: string
  scheduled_start_time?: string
  scheduled_end_time?: string
  entity_type?: number
  privacy_level?: number
  entity_metadata?: { location: string }
  status?: number
}

/** Both sides as of the last sync (the `discord_match_events` columns). */
export type Snapshot = {
  site_start: string | null
  site_twitch_url: string | null
  site_teams_key: string | null
  event_start: string | null
  event_location: string | null
}

export type SiteChanges = {
  scheduledAt?: string
  /** A new Twitch link, or null to remove the one the event used to show. */
  twitchUrl?: string | null
  cancel?: true
}

export type DiscordAction =
  | { type: 'none' }
  | { type: 'update'; body: EventBody }
  | { type: 'delete' }

export type LinkedPlan = {
  site: SiteChanges
  discord: DiscordAction
  /** The pair is finished: stop syncing it. */
  close: boolean
  snapshot: Snapshot
}

// ---------------------------------------------------------------------------
// Small helpers

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function sameTime(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return !a && !b
  return new Date(a).getTime() === new Date(b).getTime()
}

function toIso(value: string): string {
  return new Date(value).toISOString()
}

const TWITCH_RE = /^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\/([A-Za-z0-9_]{2,25})(?:[/?#]\S*)?$/i

/** A Twitch channel link in canonical form, or null if `value` is not one. */
export function normalizeTwitchUrl(value: string | null | undefined): string | null {
  const match = TWITCH_RE.exec(String(value ?? '').trim())
  return match ? `https://twitch.tv/${match[1]!.toLowerCase()}` : null
}

const CHANNEL_RE = /^@?([A-Za-z0-9_]{2,25})$/

/**
 * A stream's Twitch link. The admin form takes a platform, so a Twitch stream
 * saved as just the channel name ("ginzburgg") counts as well as a full link.
 */
export function twitchUrlForStream(
  platform: string | null | undefined,
  streamUrl: string | null | undefined
): string | null {
  const fromUrl = normalizeTwitchUrl(streamUrl)
  if (fromUrl || platform !== 'twitch') return fromUrl
  const channel = CHANNEL_RE.exec(String(streamUrl ?? '').trim())
  return channel ? `https://twitch.tv/${channel[1]!.toLowerCase()}` : null
}

/** Identifies the pairing, so a change of teams on the site renames the event. */
export function teamsKey(match: SyncMatch): string {
  return `${match.team_a?.id ?? ''}|${match.team_b?.id ?? ''}`
}

/** Scheduled or live, approved and on the calendar: the matches that have an event. */
export function isEventWorthy(match: SyncMatch): boolean {
  return (
    match.approval_status === 'approved' &&
    (match.status === 'scheduled' || match.status === 'live') &&
    Boolean(match.scheduled_at)
  )
}

export function matchUrl(origin: string, matchId: string): string {
  return `${origin.replace(/\/$/, '')}/matches/${matchId}`
}

/** A series runs about an hour a map; Discord needs an end time for external events. */
function endTime(startIso: string, bestOf: number | null): string {
  const hours = bestOf && bestOf > 0 ? bestOf : 3
  return new Date(new Date(startIso).getTime() + hours * 60 * 60 * 1000).toISOString()
}

function pairing(match: SyncMatch): string {
  return `${match.team_a?.name ?? 'TBD'} vs ${match.team_b?.name ?? 'TBD'}`
}

/** "Team A vs Team B (Bo3)". */
function eventName(match: SyncMatch): string {
  return truncate(`${pairing(match)} (Bo${match.best_of ?? 3})`, 100)
}

/**
 * Whether `name` is a title the site wrote for these teams, with or without
 * the series length (older events had none). The site may rewrite these, but
 * never a title someone typed in Discord.
 */
function isSiteName(name: string, match: SyncMatch): boolean {
  const base = pairing(match)
  if (name === base) return true
  return name.startsWith(base) && /^ \(Bo\d+\)$/.test(name.slice(base.length))
}

/**
 * The location shown when a match has no stream. Discord requires every
 * external event to have a location, so it can't be left empty.
 */
export const NO_STREAM_LOCATION = 'TBD'

function eventLocation(twitchUrl: string | null): string {
  return truncate(twitchUrl ?? NO_STREAM_LOCATION, 100)
}

function eventDescription(match: SyncMatch, origin: string): string {
  return matchUrl(origin, match.id)
}

/**
 * Whether `description` is one the site wrote: the match link, optionally
 * under an older "Best of 3" or "Bo3" line. The site may rewrite these, but
 * never text someone typed.
 */
function isSiteDescription(
  description: string | null | undefined,
  match: SyncMatch,
  origin: string
) {
  const url = matchUrl(origin, match.id)
  const lines = (description ?? '').split('\n')
  if (lines.length === 1) return lines[0] === url
  return /^(?:Best of |Bo)\d+$/.test(lines[0] ?? '') && lines.slice(1).join('\n') === url
}

// ---------------------------------------------------------------------------
// Site → Discord: creating an event

/** The body that creates `match`'s event. */
export function eventBodyForMatch(match: SyncMatch, origin: string): EventBody {
  const start = toIso(match.scheduled_at!)
  return {
    name: eventName(match),
    description: eventDescription(match, origin),
    scheduled_start_time: start,
    scheduled_end_time: endTime(start, match.best_of),
    entity_type: ENTITY_TYPE_EXTERNAL,
    privacy_level: PRIVACY_GUILD_ONLY,
    entity_metadata: { location: eventLocation(match.twitch_url) },
  }
}

/**
 * Whether `match` should get a new event. A match whose earlier event was
 * closed (ended or deleted in Discord) only gets another once the site moves
 * it to a new time; otherwise deleting an event in Discord would bring it
 * straight back.
 */
export function shouldCreateEvent(
  match: SyncMatch,
  now: Date,
  closedSiteStarts: Array<string | null> = []
): boolean {
  if (!isEventWorthy(match) || match.status !== 'scheduled') return false
  const start = new Date(match.scheduled_at!).getTime()
  // Discord rejects a start time in the past.
  if (start <= now.getTime() + 60_000 || start > now.getTime() + CREATE_WINDOW_MS) return false
  return !closedSiteStarts.some((closed) => sameTime(closed, match.scheduled_at))
}

/** The snapshot right after creating `match`'s event from `body`. */
export function snapshotAfterCreate(match: SyncMatch, body: EventBody): Snapshot {
  return {
    site_start: match.scheduled_at ? toIso(match.scheduled_at) : null,
    site_twitch_url: match.twitch_url,
    site_teams_key: teamsKey(match),
    event_start: body.scheduled_start_time ?? null,
    event_location: body.entity_metadata?.location ?? null,
  }
}

// ---------------------------------------------------------------------------
// Both directions: a linked pair

/**
 * What to do for one linked pair. `match` is null when the match was deleted
 * on the site; `event` is null when Discord no longer has the event.
 */
export function planLinked(input: {
  match: SyncMatch | null
  event: DiscordEvent | null
  snapshot: Snapshot
  now: Date
  origin: string
}): LinkedPlan {
  const { match, event, snapshot, now, origin } = input
  const none: DiscordAction = { type: 'none' }
  const eventOpen =
    event != null && (event.status === EventStatus.Scheduled || event.status === EventStatus.Active)

  // Gone from the site: take the event down with it.
  if (!match) {
    return {
      site: {},
      discord: !eventOpen ? none : endEvent(event!),
      close: true,
      snapshot,
    }
  }

  // Gone from Discord (deleted, cancelled or ended there).
  if (!eventOpen) {
    const site: SiteChanges = {}
    const removedBeforeStart =
      (event == null || event.status === EventStatus.Canceled) &&
      snapshot.event_start != null &&
      new Date(snapshot.event_start).getTime() > now.getTime()
    if (removedBeforeStart && match.status === 'scheduled') site.cancel = true
    return { site, discord: none, close: true, snapshot }
  }

  // Changes made in Discord since the last sync.
  const site: SiteChanges = {}
  const eventStart = toIso(event!.scheduled_start_time)
  const location = event!.entity_metadata?.location ?? null
  const discordMovedStart = !sameTime(eventStart, snapshot.event_start)
  const discordMovedLocation = (location ?? null) !== (snapshot.event_location ?? null)

  if (discordMovedStart && !sameTime(eventStart, match.scheduled_at)) site.scheduledAt = eventStart
  if (discordMovedLocation) {
    const twitch = normalizeTwitchUrl(location)
    if (twitch) {
      if (twitch !== match.twitch_url) site.twitchUrl = twitch
    } else if (
      match.twitch_url &&
      normalizeTwitchUrl(snapshot.event_location) === match.twitch_url
    ) {
      // The event used to show this Twitch link and now shows something else.
      site.twitchUrl = null
    }
  }

  const effectiveStart = site.scheduledAt ?? match.scheduled_at
  const effectiveTwitch = site.twitchUrl !== undefined ? site.twitchUrl : match.twitch_url

  // Finished or called off on the site.
  if (!isEventWorthy(match)) {
    return {
      site,
      discord: endEvent(event!),
      close: true,
      snapshot,
    }
  }

  // Changes made on the site since the last sync, where Discord did not also change them.
  const body: EventBody = {}
  const siteMovedStart = !sameTime(match.scheduled_at, snapshot.site_start)
  let nextEventStart = eventStart
  if (siteMovedStart && !discordMovedStart && event!.status === EventStatus.Scheduled) {
    const start = toIso(match.scheduled_at!)
    if (new Date(start).getTime() > now.getTime() && !sameTime(start, eventStart)) {
      body.scheduled_start_time = start
      body.scheduled_end_time = endTime(start, match.best_of)
      nextEventStart = start
    }
  }

  let nextLocation = location
  const siteMovedTwitch = (match.twitch_url ?? null) !== (snapshot.site_twitch_url ?? null)
  // Older events put the match page in the location. That counts as the
  // site's own value, so it's replaced even when the Twitch link hasn't changed.
  const siteLocation = location === matchUrl(origin, match.id) || location === NO_STREAM_LOCATION
  if ((siteMovedTwitch || siteLocation) && !discordMovedLocation) {
    const wanted = eventLocation(effectiveTwitch)
    if (wanted !== location) {
      body.entity_metadata = { location: wanted }
      nextLocation = wanted
    }
  }

  // Keep the site's own description current (Bo3/Bo5, the match link). Text
  // someone wrote in Discord is left alone.
  const description = eventDescription(match, origin)
  if (isSiteDescription(event!.description, match, origin) && event!.description !== description) {
    body.description = description
  }

  // A new pairing renames the event. So does a new series length, or an older
  // title without one, as long as the title is still the site's own.
  const name = eventName(match)
  if (
    name !== event!.name &&
    (teamsKey(match) !== snapshot.site_teams_key || isSiteName(event!.name, match))
  ) {
    body.name = name
  }

  return {
    site,
    discord: Object.keys(body).length > 0 ? { type: 'update', body } : none,
    close: false,
    snapshot: {
      site_start: effectiveStart ? toIso(effectiveStart) : null,
      site_twitch_url: effectiveTwitch,
      site_teams_key: teamsKey(match),
      event_start: nextEventStart,
      event_location: nextLocation,
    },
  }
}

/** A scheduled event is deleted; one already under way is marked completed instead. */
function endEvent(event: DiscordEvent): DiscordAction {
  if (event.status === EventStatus.Active) {
    return { type: 'update', body: { status: EventStatus.Completed } }
  }
  if (event.status === EventStatus.Scheduled) return { type: 'delete' }
  return { type: 'none' }
}

// ---------------------------------------------------------------------------
// Discord → site: an event created in Discord

function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const VS_RE = /\s+(?:vs\.?|v\.?|versus)\s+/i

/**
 * The best team for one side of a title. The left side may carry a prefix
 * ("Week 3: Sentinels") and the right a suffix ("Cloud9 (Bo3)"), so a team
 * also matches at the end or start of its side; the longest name wins.
 */
function matchSide(side: string, teams: SyncTeam[], at: 'end' | 'start'): SyncTeam | null {
  const text = normalizeName(side)
  if (!text) return null
  let best: { team: SyncTeam; length: number } | null = null
  for (const team of teams) {
    for (const label of [team.name, team.tag]) {
      const key = label ? normalizeName(label) : ''
      if (!key) continue
      const hit =
        text === key || (at === 'end' ? text.endsWith(` ${key}`) : text.startsWith(`${key} `))
      if (hit && (!best || key.length > best.length)) best = { team, length: key.length }
    }
  }
  return best?.team ?? null
}

/** The two teams a title like "Sentinels vs Cloud9" names, or null if it names no pair. */
export function parseMatchTitle(title: string, teams: SyncTeam[]): [SyncTeam, SyncTeam] | null {
  const parts = title.split(VS_RE)
  if (parts.length !== 2) return null
  const a = matchSide(parts[0]!, teams, 'end')
  const b = matchSide(parts[1]!, teams, 'start')
  if (!a || !b || a.id === b.id) return null
  return [a, b]
}

/** "Bo5" or "best of 5" anywhere in the text; best of 3 otherwise. */
export function parseBestOf(...texts: Array<string | null | undefined>): 3 | 5 {
  const text = texts.filter(Boolean).join(' ')
  return /\b(?:bo\s*5|best\s+of\s+5)\b/i.test(text) ? 5 : 3
}

/**
 * An existing match the Discord event is about: the same two teams (either
 * way round) within half a day of the event. Lets an event someone made by
 * hand attach to the match an admin already entered, instead of duplicating it.
 */
export function findMatchToAdopt(
  event: DiscordEvent,
  pair: [SyncTeam, SyncTeam],
  candidates: SyncMatch[]
): SyncMatch | null {
  const ids = new Set([pair[0].id, pair[1].id])
  const start = new Date(event.scheduled_start_time).getTime()
  let best: { match: SyncMatch; gap: number } | null = null
  for (const match of candidates) {
    if (!match.team_a || !match.team_b || !match.scheduled_at) continue
    if (!ids.has(match.team_a.id) || !ids.has(match.team_b.id)) continue
    const gap = Math.abs(new Date(match.scheduled_at).getTime() - start)
    if (gap <= ADOPT_WINDOW_MS && (!best || gap < best.gap)) best = { match, gap }
  }
  return best?.match ?? null
}

/** The snapshot for an event taken over from Discord as it stands. */
export function snapshotFromEvent(
  event: DiscordEvent,
  site: { scheduled_at: string | null; twitch_url: string | null; teams_key: string }
): Snapshot {
  return {
    site_start: site.scheduled_at ? toIso(site.scheduled_at) : null,
    site_twitch_url: site.twitch_url,
    site_teams_key: site.teams_key,
    event_start: toIso(event.scheduled_start_time),
    event_location: event.entity_metadata?.location ?? null,
  }
}
