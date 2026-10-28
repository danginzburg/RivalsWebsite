import { supabaseAdmin } from '$lib/supabase/admin'
import { notifyMany } from '$lib/server/notifications'

/*
 * Fan-out notifications for league events that concern more than one person:
 * a match's two rosters, or everyone in a pick'em. Like the rest of the
 * notifications layer these never throw — they run after the primary action
 * has already succeeded.
 */

type MatchSummary = {
  id: string
  season_id: string | null
  team_a_id: string | null
  team_b_id: string | null
  winner_team_id: string | null
  team_a_score: number | null
  team_b_score: number | null
  scheduled_at: string | null
  seasons: { is_active: boolean | null } | Array<{ is_active: boolean | null }> | null
}

async function loadMatch(matchId: string): Promise<MatchSummary | null> {
  const { data, error } = await supabaseAdmin
    .from('matches')
    .select(
      'id, season_id, team_a_id, team_b_id, winner_team_id, team_a_score, team_b_score, scheduled_at, seasons (is_active)'
    )
    .eq('id', matchId)
    .maybeSingle()
  if (error) console.error('Failed to load match for notifications:', error)
  return (data as MatchSummary | null) ?? null
}

/**
 * Only matches in the active season notify. Admins backfill and re-edit past
 * seasons constantly, and those players don't need a feed full of history.
 */
function isLiveSeason(match: MatchSummary): boolean {
  const season = Array.isArray(match.seasons) ? match.seasons[0] : match.seasons
  return Boolean(season?.is_active)
}

async function loadTeamNames(teamIds: string[]): Promise<Map<string, string>> {
  if (teamIds.length === 0) return new Map()
  const { data } = await supabaseAdmin.from('teams').select('id, name').in('id', teamIds)
  return new Map((data ?? []).map((t) => [t.id as string, (t.name as string) || 'TBD']))
}

/** Profile ids currently rostered on each team (signed-in players only). */
async function loadRosters(teamIds: string[]): Promise<Map<string, string[]>> {
  const rosters = new Map<string, string[]>()
  if (teamIds.length === 0) return rosters
  const { data, error } = await supabaseAdmin
    .from('team_memberships')
    .select('team_id, profile_id')
    .in('team_id', teamIds)
    .eq('is_active', true)
    .is('left_at', null)
    .not('profile_id', 'is', null)
  if (error) console.error('Failed to load rosters for notifications:', error)
  for (const row of data ?? []) {
    const list = rosters.get(row.team_id as string) ?? []
    list.push(row.profile_id as string)
    rosters.set(row.team_id as string, list)
  }
  return rosters
}

type MatchSide = { teamId: string; opponentName: string; profileIds: string[] }

/** Each side of a live match with its roster and the opponent it faces. */
async function loadMatchSides(
  matchId: string
): Promise<{ match: MatchSummary; sides: MatchSide[] } | null> {
  const match = await loadMatch(matchId)
  if (!match || !isLiveSeason(match)) return null
  const teamIds = [match.team_a_id, match.team_b_id].filter((id): id is string => Boolean(id))
  if (teamIds.length === 0) return null

  const [names, rosters] = await Promise.all([loadTeamNames(teamIds), loadRosters(teamIds)])
  const sides: MatchSide[] = teamIds.map((teamId) => {
    const opponentId = teamId === match.team_a_id ? match.team_b_id : match.team_a_id
    return {
      teamId,
      opponentName: (opponentId && names.get(opponentId)) || 'TBD',
      profileIds: rosters.get(teamId) ?? [],
    }
  })
  return { match, sides }
}

function formatUtc(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  return `${date.toLocaleString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })} UTC`
}

/** Tell both rosters their match time was set or moved. */
export async function notifyMatchScheduled(matchId: string, actorProfileId: string) {
  try {
    const loaded = await loadMatchSides(matchId)
    if (!loaded?.match.scheduled_at) return
    const when = formatUtc(loaded.match.scheduled_at)
    await Promise.all(
      loaded.sides.map((side) =>
        notifyMany({
          recipientProfileIds: side.profileIds,
          type: 'match_scheduled',
          title: `Your match vs ${side.opponentName} is scheduled`,
          body: when ? `${when} — open the match for your local time.` : null,
          link: `/matches/${matchId}`,
          actorProfileId,
          entityType: 'match',
          entityId: matchId,
          // A reschedule refreshes the unread entry rather than stacking.
          dedupeKey: `match_scheduled:${matchId}`,
        })
      )
    )
  } catch (err) {
    console.error('Failed to notify match schedule:', err)
  }
}

/** Tell both rosters the final result once a match is completed. */
export async function notifyMatchResult(matchId: string, actorProfileId: string) {
  try {
    const loaded = await loadMatchSides(matchId)
    if (!loaded) return
    const { match } = loaded
    await Promise.all(
      loaded.sides.map((side) => {
        const isTeamA = side.teamId === match.team_a_id
        const own = (isTeamA ? match.team_a_score : match.team_b_score) ?? 0
        const other = (isTeamA ? match.team_b_score : match.team_a_score) ?? 0
        const outcome = !match.winner_team_id
          ? 'drew'
          : match.winner_team_id === side.teamId
            ? 'won'
            : 'lost'
        return notifyMany({
          recipientProfileIds: side.profileIds,
          type: 'match_result',
          title: `You ${outcome} ${own}–${other} vs ${side.opponentName}`,
          body: 'The result is final. Stats and standings have been updated.',
          link: `/matches/${matchId}`,
          actorProfileId,
          entityType: 'match',
          entityId: matchId,
          // A corrected score replaces the unread entry instead of adding one.
          dedupeKey: `match_result:${matchId}`,
        })
      })
    )
  } catch (err) {
    console.error('Failed to notify match result:', err)
  }
}

/** Tell both rosters a match was called off. */
export async function notifyMatchCancelled(matchId: string, actorProfileId: string) {
  try {
    const loaded = await loadMatchSides(matchId)
    if (!loaded) return
    await Promise.all(
      loaded.sides.map((side) =>
        notifyMany({
          recipientProfileIds: side.profileIds,
          type: 'match_cancelled',
          title: `Your match vs ${side.opponentName} was cancelled`,
          body: 'Reach out to an admin if you think this is a mistake.',
          link: `/matches/${matchId}`,
          actorProfileId,
          entityType: 'match',
          entityId: matchId,
        })
      )
    )
  } catch (err) {
    console.error('Failed to notify match cancellation:', err)
  }
}

type PickemSeason = { id: string; code: string; name: string }

/** Announce a newly opened pick'em to every member who can take part. */
export async function notifyPickemOpened(season: PickemSeason, lockAt: string | null) {
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .or('role.is.null,role.not.in.(restricted,banned)')
    if (error) {
      console.error('Failed to load profiles for pick’em announcement:', error)
      return
    }
    const lock = lockAt ? formatUtc(lockAt) : ''
    await notifyMany({
      recipientProfileIds: (data ?? []).map((p) => p.id as string),
      type: 'pickem_opened',
      title: `${season.name} Pick’em is open`,
      body: lock ? `Get your picks in before ${lock}.` : 'Get your picks in before it locks.',
      link: `/pickems/${season.code}`,
      entityType: 'season',
      entityId: season.id,
    })
  } catch (err) {
    console.error('Failed to announce pick’em:', err)
  }
}

/** Tell everyone who submitted picks that their score is in. */
export async function notifyPickemScored(season: PickemSeason, eventId: string) {
  try {
    const { data, error } = await supabaseAdmin
      .from('pickem_submissions')
      .select('profile_id')
      .eq('event_id', eventId)
    if (error) {
      console.error('Failed to load pick’em submitters:', error)
      return
    }
    await notifyMany({
      recipientProfileIds: (data ?? []).map((s) => s.profile_id as string),
      type: 'pickem_scored',
      title: `${season.name} Pick’em results are in`,
      body: 'See how your picks scored on the leaderboard.',
      link: `/pickems/${season.code}`,
      entityType: 'season',
      entityId: season.id,
    })
  } catch (err) {
    console.error('Failed to notify pick’em scores:', err)
  }
}
