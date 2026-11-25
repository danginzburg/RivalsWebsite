import { waitUntil } from '@vercel/functions'
import { supabaseAdmin } from '$lib/supabase/admin'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { sectionLabel } from '$lib/stats/sections'
import type { PickemEvent } from '$lib/pickems'
import { loadPickemFinal } from '$lib/server/og/pickem-card'
import { loadStandings } from '$lib/server/leaderboard/standings'
import { loadSeasonReplay } from '$lib/server/leaderboard/history'
import { ranksAsOf, seriesPlayedBetween } from '$lib/server/leaderboard/rank-history'
import { cardVersion } from '$lib/meta'
import {
  isDryRun,
  siteUrl,
  streamPingRoleId,
  announcementsPingRoleId,
  webhookOptions,
  webhookUrlFor,
  type DiscordChannel,
} from './config'
import {
  adminAlertPayload,
  matchCancelledPayload,
  matchReminderPayload,
  matchResultPayload,
  matchScheduledPayload,
  pickemLockWarningPayload,
  pickemLockedPayload,
  pickemOpenedPayload,
  pickemFinalPayload,
  streamAddedPayload,
  streamEndedPayload,
  streamLivePayload,
  teamLogoPayload,
  vodPayload,
  weeklyStandingsPayload,
  withRolePing,
  withUserPings,
  vodStageLine,
  type AdminAlert,
  type MatchRef,
  type PickemRef,
  type StreamInput,
  type WeeklyStandingsRow,
} from './embeds'
import {
  deletePost,
  matchThreadId,
  sendOnce,
  upsertPost,
  type PostKey,
  type UpsertMode,
} from './posts'
import { discordConfig, sendDirectMessage } from '$lib/server/discord-events/api'
import type { WebhookPayload } from './webhook'

/*
 * Automatic Discord posts for site events.
 *
 * Callers fire these and move on: the work runs after the response through
 * Vercel's waitUntil, and every failure is logged, never thrown. Only events
 * in the active season post, so backfills and edits to past seasons stay out
 * of Discord. Bulk and rebuild paths never call these; callers that share
 * code with them pass `announce: false` through the notification layer.
 */

/** Run `task` after the response without letting it fail the request. */
export function inBackground(label: string, task: () => Promise<unknown>): void {
  const promise = task().catch((err) => console.error(`Discord ${label} failed:`, err))
  try {
    waitUntil(promise)
  } catch {
    // Outside Vercel there is no request context; the promise still runs.
  }
}

async function post(
  channel: DiscordChannel,
  kind: string,
  subjectId: string,
  payload: WebhookPayload,
  opts: { mode?: UpsertMode; threadId?: string | null; ping?: boolean } = {}
) {
  const url = webhookUrlFor(channel)
  if (!url) return 'skipped' as const
  const key: PostKey = { kind, subjectId, channel }
  const { ping = true, ...upsertOpts } = opts
  // Posts in #rivals-annoucements ping @Rivals Player unless they opt out.
  const body =
    channel === 'announcements' && ping ? withRolePing(payload, announcementsPingRoleId()) : payload
  return upsertPost(key, url, body, { ...webhookOptions(), ...upsertOpts })
}

async function remove(channel: DiscordChannel, kind: string, subjectId: string) {
  const url = webhookUrlFor(channel)
  if (!url) return false
  return deletePost({ kind, subjectId, channel }, url, webhookOptions())
}

// ── Loading ─────────────────────────────────────────────────────────────────

type TeamRel = { id: string; name: string | null; tag: string | null }
type SeasonRel = { id: string; name: string | null; code: string | null; is_active: boolean | null }

const one = <T>(rel: T | T[] | null | undefined): T | null =>
  Array.isArray(rel) ? (rel[0] ?? null) : (rel ?? null)

export type LoadedMatch = MatchRef & {
  status: string
  seasonId: string | null
  scoreA: number
  scoreB: number
  winnerTeamId: string | null
  teamAId: string | null
  teamBId: string | null
  stage: string | null
  designation: string | null
  vodUrl: string | null
  /** metadata.forfeit when the whole match was decided by forfeit. */
  forfeit: { kind: 'no_show' | 'admin_award'; teamId: string | null; reason: string | null } | null
}

type RawForfeit = {
  kind?: unknown
  forfeiting_team_id?: unknown
  reason?: unknown
  label?: unknown
}

function matchForfeit(raw: RawForfeit | null | undefined): LoadedMatch['forfeit'] {
  if (!raw || (raw.kind !== 'no_show' && raw.kind !== 'admin_award')) return null
  return {
    kind: raw.kind,
    teamId: typeof raw.forfeiting_team_id === 'string' ? raw.forfeiting_team_id : null,
    reason: typeof raw.reason === 'string' && raw.reason.trim() ? raw.reason.trim() : null,
  }
}

/** A match in the active season that visitors can see, or null. */
export async function loadAnnounceableMatch(matchId: string): Promise<LoadedMatch | null> {
  const { data: match, error } = await supabaseAdmin
    .from('matches')
    .select(
      `id, status, approval_status, scheduled_at, best_of, stage,
       team_a_id, team_b_id, team_a_score, team_b_score, winner_team_id, metadata, season_id,
       season:seasons (id, name, code, is_active),
       team_a:teams!matches_team_a_id_fkey (id, name, tag),
       team_b:teams!matches_team_b_id_fkey (id, name, tag)`
    )
    .eq('id', matchId)
    .maybeSingle()
  if (error) console.error('Failed to load match for Discord:', error)
  if (!match || match.approval_status !== 'approved') return null
  const season = one(match.season as SeasonRel | SeasonRel[] | null)
  if (!season?.is_active) return null

  const a = one(match.team_a as TeamRel | TeamRel[] | null)
  const b = one(match.team_b as TeamRel | TeamRel[] | null)
  const metadata = match.metadata as {
    designation?: string
    youtube_vod_url?: string
    forfeit?: RawForfeit
  } | null
  const designation = metadata?.designation?.trim() || null
  const stageText = match.stage ? sectionLabel(match.stage) : null

  return {
    matchId: match.id as string,
    siteUrl: siteUrl(),
    teamA: { name: a?.name || 'TBD', tag: a?.tag ?? null },
    teamB: { name: b?.name || 'TBD', tag: b?.tag ?? null },
    event:
      [season.name?.replace(/\s+/g, ' '), vodStageLine(stageText, designation)]
        .filter(Boolean)
        .join(' · ') || null,
    scheduledAt: (match.scheduled_at as string | null) ?? null,
    bestOf: (match.best_of as number | null) ?? null,
    status: match.status as string,
    seasonId: (match.season_id as string | null) ?? season.id,
    scoreA: (match.team_a_score as number | null) ?? 0,
    scoreB: (match.team_b_score as number | null) ?? 0,
    winnerTeamId: (match.winner_team_id as string | null) ?? null,
    teamAId: (match.team_a_id as string | null) ?? null,
    teamBId: (match.team_b_id as string | null) ?? null,
    stage: stageText,
    designation,
    vodUrl: metadata?.youtube_vod_url?.trim() || null,
    forfeit: matchForfeit(metadata?.forfeit),
  }
}

/** Map rows as stored: forfeits keep the conceding team id, resolved to a side later. */
async function loadMaps(matchId: string) {
  const { data } = await supabaseAdmin
    .from('match_maps')
    .select('map_order, map_name, team_a_rounds, team_b_rounds, is_voided, metadata')
    .eq('match_id', matchId)
    .order('map_order')
  return (data ?? []).flatMap((m) => {
    if (m.is_voided || m.team_a_rounds == null || m.team_b_rounds == null) return []
    const raw = (m.metadata as { forfeit?: RawForfeit } | null)?.forfeit
    const forfeit = raw
      ? {
          teamId: typeof raw.forfeiting_team_id === 'string' ? raw.forfeiting_team_id : null,
          label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : null,
        }
      : null
    // A forfeited map was never played, so it has no map name; keep it anyway.
    if (!m.map_name && !forfeit) return []
    return [
      {
        name: (m.map_name as string | null) || null,
        a: m.team_a_rounds as number,
        b: m.team_b_rounds as number,
        forfeit,
      },
    ]
  })
}

/** The series' top ACS, when player stats have been imported. */
async function loadMvp(matchId: string) {
  const { data } = await supabaseAdmin
    .from('player_match_stats')
    .select('player_name, acs, agents')
    .eq('match_id', matchId)
    .not('acs', 'is', null)
    .order('acs', { ascending: false })
    .limit(1)
  const top = data?.[0]
  if (!top?.player_name) return null
  const agent = typeof top.agents === 'string' ? top.agents.split(/[,/]/)[0]?.trim() || null : null
  return {
    name: (top.player_name as string).split('#')[0],
    acs: (top.acs as number | null) ?? null,
    agent,
  }
}

// ── Matches ─────────────────────────────────────────────────────────────────

/**
 * The match's r5-match-scheduling thread gets one schedule post: the first
 * time is posted, a new time edits it and marks it rescheduled, and a
 * cancellation edits it to say so. No linked thread, no post.
 */
export async function postMatchScheduled(matchId: string) {
  const match = await loadAnnounceableMatch(matchId)
  if (!match?.scheduledAt) return
  const threadId = await matchThreadId(matchId)
  if (!threadId) return
  const first = await post('scheduling', 'match_schedule', matchId, matchScheduledPayload(match), {
    mode: 'once',
    threadId,
  })
  if (first === 'skipped') {
    await post(
      'scheduling',
      'match_schedule',
      matchId,
      matchScheduledPayload({ ...match, rescheduled: true }),
      {
        mode: 'edit',
        threadId,
      }
    )
  }
}

export async function postMatchCancelled(matchId: string) {
  const match = await loadAnnounceableMatch(matchId)
  if (!match) return
  const threadId = await matchThreadId(matchId)
  if (!threadId) return
  await post('scheduling', 'match_schedule', matchId, matchCancelledPayload(match), { threadId })
}

/**
 * Discord user ids of everyone on the two rosters who has a linked Discord
 * account. Teams are per season, so active memberships of these team ids are
 * this season's rosters.
 */
async function loadRosterDiscordIds(teamIds: Array<string | null>): Promise<string[]> {
  const ids = teamIds.filter((id): id is string => Boolean(id))
  if (ids.length === 0) return []
  const { data: members, error: memberError } = await supabaseAdmin
    .from('team_memberships')
    .select('profile_id')
    .in('team_id', ids)
    .eq('is_active', true)
    .is('left_at', null)
    .not('profile_id', 'is', null)
  if (memberError) console.error('Failed to load rosters for the match reminder:', memberError)
  const profileIds = [...new Set((members ?? []).map((m) => m.profile_id as string))]
  if (profileIds.length === 0) return []
  const { data: profiles, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('discord_id')
    .in('id', profileIds)
    .not('discord_id', 'is', null)
  if (profileError)
    console.error('Failed to load Discord ids for the match reminder:', profileError)
  return [...new Set((profiles ?? []).map((p) => p.discord_id as string))]
}

/**
 * The morning-of reminder: posted in the match's thread with every rostered
 * player @mentioned, once per start time. DMs to each player are built but
 * switched off (REMINDER_DMS_ENABLED) until players can opt in.
 */
export async function postMatchReminder(matchId: string) {
  const match = await loadAnnounceableMatch(matchId)
  if (!match?.scheduledAt || match.status !== 'scheduled') return
  const [threadId, players] = await Promise.all([
    matchThreadId(matchId),
    loadRosterDiscordIds([match.teamAId, match.teamBId]),
  ])
  // Keyed on the start time, so a rescheduled match gets a fresh reminder.
  const reminderKey = `${matchId}:${match.scheduledAt}`
  const reminder = matchReminderPayload(match)

  if (threadId) {
    await post('scheduling', 'match_reminder', reminderKey, withUserPings(reminder, players), {
      mode: 'once',
      threadId,
    })
  }
  if (REMINDER_DMS_ENABLED) await dmMatchReminder(reminderKey, reminder, players, threadId)
}

/**
 * Off for now: DMing every player felt too pushy to start. Before turning it
 * on, filter `players` to those who opted in (a profile setting).
 */
const REMINDER_DMS_ENABLED = false

async function dmMatchReminder(
  reminderKey: string,
  reminder: WebhookPayload,
  players: string[],
  threadId: string | null
) {
  const config = discordConfig()
  if (!config || players.length === 0) return
  const body: WebhookPayload = {
    ...reminder,
    content: threadId
      ? `Your match is today. Scheduling thread: https://discord.com/channels/${config.guildId}/${threadId}`
      : 'Your match is today.',
    allowed_mentions: { parse: [] },
  }
  for (const userId of players) {
    await sendOnce(
      { kind: 'match_reminder_dm', subjectId: `${reminderKey}:${userId}`, channel: 'dm' },
      async () => {
        if (isDryRun()) {
          console.log(`[discord dry run] DM ${userId}:`, JSON.stringify(body))
          return 'dry-run'
        }
        try {
          return (await sendDirectMessage(config, userId, body)).id
        } catch (err) {
          // Closed DMs (50007) won't open by retrying; record them as handled.
          if (err instanceof Error && /\b50007\b/.test(err.message)) {
            console.warn(`Match reminder DM to ${userId} refused (DMs closed).`)
            return 'dms-closed'
          }
          throw err
        }
      }
    )
  }
}

function resultPayload(
  match: LoadedMatch,
  maps: Awaited<ReturnType<typeof loadMaps>>,
  mvp: Awaited<ReturnType<typeof loadMvp>>
) {
  const side = (teamId: string | null) =>
    teamId && teamId === match.teamAId ? 'a' : teamId && teamId === match.teamBId ? 'b' : null
  return matchResultPayload({
    ...match,
    winner: side(match.winnerTeamId),
    maps: maps.map((m) => ({
      ...m,
      forfeit: m.forfeit ? { by: side(m.forfeit.teamId), label: m.forfeit.label } : null,
    })),
    mvp,
    forfeit: match.forfeit
      ? { kind: match.forfeit.kind, by: side(match.forfeit.teamId), reason: match.forfeit.reason }
      : null,
    cardVersion: `${match.status}-${match.scoreA}-${match.scoreB}-${maps.map((m) => `${m.a}.${m.b}${m.forfeit ? 'ff' : ''}`).join('_')}${match.forfeit ? `-${match.forfeit.kind}` : ''}`,
  })
}

async function postVod(match: LoadedMatch, mode: UpsertMode) {
  if (!match.vodUrl) {
    await remove('vods', 'match_vod', match.matchId)
    return
  }
  await post(
    'vods',
    'match_vod',
    match.matchId,
    vodPayload({
      teamA: match.teamA,
      teamB: match.teamB,
      stageLine: vodStageLine(match.stage, match.designation),
      scheduledAt: match.scheduledAt,
      vodUrl: match.vodUrl,
    }),
    { mode }
  )
}

/**
 * #match-results for a completed match. `mode: 'edit'` only refreshes a result
 * already posted (a corrected score), so old matches are never announced late.
 */
export async function postMatchResult(matchId: string, mode: UpsertMode = 'upsert') {
  const match = await loadAnnounceableMatch(matchId)
  if (!match || match.status !== 'completed') return
  const [maps, mvp] = await Promise.all([loadMaps(matchId), loadMvp(matchId)])
  await post('results', 'match_result', matchId, resultPayload(match, maps, mvp), { mode })
  if (match.vodUrl) await postVod(match, 'upsert')
}

/**
 * After an ordinary edit: refresh whatever was already posted for the match,
 * and post the VOD the first time one is added.
 */
export async function refreshMatchPosts(matchId: string) {
  const match = await loadAnnounceableMatch(matchId)
  if (!match) return
  if (match.status === 'completed') {
    const [maps, mvp] = await Promise.all([loadMaps(matchId), loadMvp(matchId)])
    await post('results', 'match_result', matchId, resultPayload(match, maps, mvp), {
      mode: 'edit',
    })
    await postVod(match, 'upsert')
  }
}

// ── Streams ─────────────────────────────────────────────────────────────────

/** A stream was added or edited: #prod-announcements, plus #official-streams once it is live. */
export async function postStreamSaved(streamId: string) {
  const { data: stream } = await supabaseAdmin
    .from('match_streams')
    .select('id, match_id, platform, stream_url, status, metadata')
    .eq('id', streamId)
    .maybeSingle()
  if (!stream) return
  const match = await loadAnnounceableMatch(stream.match_id as string)
  if (!match || match.status === 'cancelled') return

  const input: StreamInput = {
    ...match,
    platform: stream.platform as string,
    streamUrl: stream.stream_url as string,
    displayName: (stream.metadata as { display_name?: string | null } | null)?.display_name ?? null,
  }
  await post('prod', 'stream_added', streamId, streamAddedPayload(input))
  if (stream.status === 'live') {
    await post('streams', 'stream_live', streamId, streamLivePayload(input, streamPingRoleId()))
  } else if (stream.status === 'ended') {
    await post('streams', 'stream_live', streamId, streamEndedPayload(input), { mode: 'edit' })
  }
}

export async function postStreamDeleted(streamId: string) {
  await Promise.all([
    remove('prod', 'stream_added', streamId),
    remove('streams', 'stream_live', streamId),
  ])
}

// ── Teams ───────────────────────────────────────────────────────────────────

/** #team-logos: posted on approval; later name, tag or logo changes edit it. */
export async function postTeamLogo(teamId: string, mode: UpsertMode = 'upsert') {
  const { data: team } = await supabaseAdmin
    .from('teams')
    .select(
      'id, name, tag, logo_path, approval_status, season:seasons!teams_season_id_fkey (id, name, code, is_active)'
    )
    .eq('id', teamId)
    .maybeSingle()
  if (!team || team.approval_status !== 'approved') return
  const season = one(team.season as SeasonRel | SeasonRel[] | null)
  if (!season?.is_active) return
  const origin = siteUrl()
  await post(
    'team_logos',
    'team_logo',
    teamId,
    teamLogoPayload({
      name: team.name as string,
      tag: (team.tag as string | null) ?? null,
      logoUrl: getTeamLogoUrl(team),
      seasonName: season.name ?? null,
      teamUrl: `${origin}/teams/${teamId}`,
    }),
    { mode }
  )
}

// ── Pick'ems ────────────────────────────────────────────────────────────────

type PickemSeason = { id: string; code: string; name: string }

function pickemRef(season: PickemSeason, event: Pick<PickemEvent, 'title' | 'lockAt'>): PickemRef {
  return {
    siteUrl: siteUrl(),
    seasonCode: season.code,
    title: event.title?.trim() || `${season.name} Pick’em`,
    lockAt: event.lockAt,
  }
}

async function isActiveSeason(seasonId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('seasons')
    .select('is_active')
    .eq('id', seasonId)
    .maybeSingle()
  return Boolean(data?.is_active)
}

export async function postPickemOpened(
  season: PickemSeason,
  event: Pick<PickemEvent, 'id' | 'title' | 'lockAt'>
) {
  if (!(await isActiveSeason(season.id))) return
  await post(
    'announcements',
    'pickem_opened',
    event.id,
    pickemOpenedPayload(pickemRef(season, event))
  )
}

export async function postPickemLocked(
  season: PickemSeason,
  event: Pick<PickemEvent, 'id' | 'title' | 'lockAt'>
) {
  if (!(await isActiveSeason(season.id))) return
  await post(
    'announcements',
    'pickem_locked',
    event.id,
    pickemLockedPayload(pickemRef(season, event)),
    {
      mode: 'once',
    }
  )
}

export async function postPickemLockWarning(
  season: PickemSeason,
  event: Pick<PickemEvent, 'id' | 'title' | 'lockAt'>
) {
  if (!(await isActiveSeason(season.id))) return
  await post(
    'announcements',
    'pickem_lock_warning',
    `${event.id}:${event.lockAt}`,
    pickemLockWarningPayload(pickemRef(season, event)),
    { mode: 'once' }
  )
}

/**
 * The pick'em went final ("Final now"): the winner(s), the top of the
 * leaderboard and the standings card. Re-scoring edits the post.
 */
export async function postPickemFinal(eventId: string, mode: UpsertMode = 'upsert') {
  const final = await loadPickemFinal(eventId)
  if (!final || final.status !== 'scored' || !(await isActiveSeason(final.seasonId))) return
  const origin = siteUrl()
  // Changes with the standings, so Discord refetches the card after a correction.
  const version = final.board.map((e) => `${e.rank}.${e.score}`).join('_') || 'empty'
  await post(
    'announcements',
    'pickem_final',
    eventId,
    pickemFinalPayload({
      siteUrl: origin,
      seasonCode: final.seasonCode,
      title: final.title,
      lockAt: null,
      board: final.board,
      imageUrl: `${origin}/og/pickem/${eventId}.png?v=${encodeURIComponent(version)}`,
    }),
    { mode }
  )
}

// ── Weekly standings ────────────────────────────────────────────────────────

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** Ping @Rivals Player on the weekly standings, like every other announcement. */
const WEEKLY_STANDINGS_PING = true

/**
 * The Monday standings post in #rivals-annoucements: the running season's
 * table, each team's movement over the past week, and the standings card.
 * Skipped between seasons and in a week with no standings series (nothing
 * moved). One post per season per `weekKey`, so a rerun never double-posts.
 */
export async function postWeeklyStandings(weekKey: string, now: number = Date.now()) {
  const standings = await loadStandings()
  const season = standings.season
  if (!season?.id || !season.name) return 'skipped' as const

  const replay = await loadSeasonReplay(season.id)
  if (!replay) return 'skipped' as const
  const seriesThisWeek = seriesPlayedBetween(replay.matches, now - WEEK_MS, now)
  if (seriesThisWeek === 0) return 'skipped' as const

  const before = ranksAsOf(
    replay.teams,
    replay.matches,
    replay.adjustments,
    replay.scoring,
    now - WEEK_MS
  )
  const ranked = standings.rows.filter((r) => r.stats?.rank != null && !r.disbanded)
  if (ranked.length === 0) return 'skipped' as const

  const rows: WeeklyStandingsRow[] = ranked.map((r) => {
    const stats = r.stats!
    const prev = before.get(r.id)
    return {
      rank: stats.rank!,
      name: r.name,
      tag: r.tag,
      wins: stats.series_wins,
      losses: stats.series_losses,
      mapWins: stats.map_wins,
      mapLosses: stats.map_losses,
      roundDiff: stats.round_diff,
      move: prev && prev.played > 0 ? prev.rank - stats.rank! : null,
    }
  })

  const origin = siteUrl()
  // Same version recipe as the /leaderboard page, so Discord shows this week's card.
  const version = cardVersion([
    season.name,
    standings.rows.slice(0, 8).map((r) => [r.id, r.name, r.logo_url, r.stats]),
  ])
  return post(
    'announcements',
    'weekly_standings',
    `${season.id}:${weekKey}`,
    weeklyStandingsPayload({
      siteUrl: origin,
      season: season.name.replace(/\s+/g, ' '),
      rows,
      seriesThisWeek,
      imageUrl: `${origin}/og/leaderboard.png?v=${version}`,
    }),
    { mode: 'once', ping: WEEKLY_STANDINGS_PING }
  )
}

// ── Admin alerts ────────────────────────────────────────────────────────────

/** One post per queued item in the private staff channel. */
export async function postAdminAlert(itemId: string, alert: AdminAlert) {
  if (alert.kind === 'match_report' && !alert.matchLabel) {
    const { data } = await supabaseAdmin
      .from('matches')
      .select(
        'team_a:teams!matches_team_a_id_fkey (id, name, tag), team_b:teams!matches_team_b_id_fkey (id, name, tag)'
      )
      .eq('id', alert.matchId)
      .maybeSingle()
    const a = one(data?.team_a as TeamRel | TeamRel[] | null)
    const b = one(data?.team_b as TeamRel | TeamRel[] | null)
    alert = { ...alert, matchLabel: `${a?.name || 'TBD'} vs ${b?.name || 'TBD'}` }
  }
  await post('admin', `admin_${alert.kind}`, itemId, adminAlertPayload(alert, siteUrl()), {
    mode: 'once',
  })
}
