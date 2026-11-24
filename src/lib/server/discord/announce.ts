import { waitUntil } from '@vercel/functions'
import { supabaseAdmin } from '$lib/supabase/admin'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { sectionLabel } from '$lib/stats/sections'
import { combinePickemSeasonTotals, isPickemComplete, type PickemEvent } from '$lib/pickems'
import {
  getPickemResults,
  getPublishedPickemContextBySeasonId,
  listPickemPublicSubmissions,
} from '$lib/server/pickems'
import {
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
  pickemWinnerPayload,
  streamAddedPayload,
  streamEndedPayload,
  streamLivePayload,
  teamLogoPayload,
  vodPayload,
  withRolePing,
  vodStageLine,
  type AdminAlert,
  type MatchRef,
  type PickemRef,
  type StreamInput,
} from './embeds'
import { deletePost, matchThreadId, upsertPost, type PostKey, type UpsertMode } from './posts'
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
  opts: { mode?: UpsertMode; threadId?: string | null } = {}
) {
  const url = webhookUrlFor(channel)
  if (!url) return 'skipped' as const
  const key: PostKey = { kind, subjectId, channel }
  // Everything in #rivals-annoucements pings @Rivals Player.
  const body =
    channel === 'announcements' ? withRolePing(payload, announcementsPingRoleId()) : payload
  return upsertPost(key, url, body, { ...webhookOptions(), ...opts })
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
  const metadata = match.metadata as { designation?: string; youtube_vod_url?: string } | null
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
  }
}

async function loadMaps(matchId: string) {
  const { data } = await supabaseAdmin
    .from('match_maps')
    .select('map_order, map_name, team_a_rounds, team_b_rounds, is_voided')
    .eq('match_id', matchId)
    .order('map_order')
  return (data ?? [])
    .filter((m) => !m.is_voided && m.map_name && m.team_a_rounds != null && m.team_b_rounds != null)
    .map((m) => ({
      name: m.map_name as string,
      a: m.team_a_rounds as number,
      b: m.team_b_rounds as number,
    }))
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

export async function postMatchReminder(matchId: string) {
  const match = await loadAnnounceableMatch(matchId)
  if (!match?.scheduledAt || match.status !== 'scheduled') return
  const threadId = await matchThreadId(matchId)
  if (!threadId) return
  // Keyed on the start time, so a rescheduled match gets a fresh reminder.
  await post(
    'scheduling',
    'match_reminder',
    `${matchId}:${match.scheduledAt}`,
    matchReminderPayload(match),
    {
      mode: 'once',
      threadId,
    }
  )
}

function resultPayload(
  match: LoadedMatch,
  maps: Awaited<ReturnType<typeof loadMaps>>,
  mvp: Awaited<ReturnType<typeof loadMvp>>
) {
  return matchResultPayload({
    ...match,
    winner:
      match.winnerTeamId && match.winnerTeamId === match.teamAId
        ? 'a'
        : match.winnerTeamId && match.winnerTeamId === match.teamBId
          ? 'b'
          : null,
    maps,
    mvp,
    cardVersion: `${match.status}-${match.scoreA}-${match.scoreB}-${maps.map((m) => `${m.a}.${m.b}`).join('_')}`,
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
  if (match.seasonId) await postPickemWinnerIfSettled(match.seasonId)
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
 * The season's pick'em winner, once every published pick'em has all its
 * results in (in practice: when the grand final is imported). A later
 * correction edits the post.
 */
export async function postPickemWinnerIfSettled(seasonId: string) {
  if (!(await isActiveSeason(seasonId))) return
  const boards = []
  let season: PickemSeason | null = null
  for (const format of ['bracket', 'matchups'] as const) {
    const ctx = await getPublishedPickemContextBySeasonId(seasonId, format)
    if (!ctx.event || ctx.matches.length === 0) continue
    season ??= { id: ctx.season.id, code: ctx.season.code, name: ctx.season.name }
    const { actualWinners } = await getPickemResults(ctx.event, ctx.matches)
    if (!isPickemComplete(ctx.matches, actualWinners)) return
    boards.push(await listPickemPublicSubmissions(ctx.event.id, ctx.matches, actualWinners))
  }
  if (!season || boards.length === 0) return
  const podium = combinePickemSeasonTotals(boards)
    .filter((e) => e.score > 0 && e.rank <= 3)
    .map((e) => ({ name: e.user.name, score: e.score, rank: e.rank }))
  if (podium.length === 0) return
  await post(
    'announcements',
    'pickem_winner',
    seasonId,
    // Totals combine the bracket and weekly pick'ems, so this names the season, not one event.
    pickemWinnerPayload({ ...pickemRef(season, { title: '', lockAt: null }), podium })
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
