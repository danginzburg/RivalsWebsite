import { supabaseAdmin } from '$lib/supabase/admin'
import { notifyMatchScheduled } from '$lib/server/notifications/events'
import { syncMatchToDiscord } from '$lib/server/discord-events/sync'

/**
 * `/set-time`: give a match its start time from its scheduling thread. Runs
 * the same follow-ups as a time set in the site's match editor: the rosters'
 * notifications, the schedule post in the thread (through
 * `notifyMatchScheduled`), and the Discord scheduled event, created or moved
 * (through `syncMatchToDiscord`).
 */

/** The match a scheduling thread is linked to, if any. */
export async function matchForThread(threadId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('discord_posts')
    .select('subject_id')
    .eq('kind', 'match_thread')
    .eq('channel', 'scheduling')
    .eq('thread_id', threadId)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Failed to look up the thread's match: ${error.message}`)
  return (data?.subject_id as string | undefined) ?? null
}

export type SettableMatch = {
  id: string
  status: string | null
  approval_status: string | null
  scheduled_at: string | null
  pairing: string
}

type TeamRel = { name: string } | Array<{ name: string }> | null

function teamName(rel: TeamRel): string {
  return (Array.isArray(rel) ? rel[0]?.name : rel?.name) ?? 'TBD'
}

export async function loadSettableMatch(matchId: string): Promise<SettableMatch | null> {
  const { data } = await supabaseAdmin
    .from('matches')
    .select(
      `id, status, approval_status, scheduled_at,
       team_a:teams!matches_team_a_id_fkey (name),
       team_b:teams!matches_team_b_id_fkey (name)`
    )
    .eq('id', matchId)
    .maybeSingle()
  if (!data) return null
  const row = data as unknown as {
    id: string
    status: string | null
    approval_status: string | null
    scheduled_at: string | null
    team_a: TeamRel
    team_b: TeamRel
  }
  return {
    id: row.id,
    status: row.status,
    approval_status: row.approval_status,
    scheduled_at: row.scheduled_at,
    pairing: `${teamName(row.team_a)} vs ${teamName(row.team_b)}`,
  }
}

/** Why this match's time can't be set from Discord, or null if it can. */
export function setTimeProblem(match: SettableMatch | null): string | null {
  if (!match || match.approval_status !== 'approved') return 'That match isn’t on the site.'
  if (match.status === 'completed') return 'That match is already completed.'
  if (match.status === 'cancelled') return 'That match is cancelled.'
  return null
}

/** Save the time, then bring the rosters, the thread post and the Discord event up to date. */
export async function setMatchTime(input: {
  matchId: string
  scheduledAt: string
  actorProfileId: string | null
  origin: string
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from('matches')
    .update({ scheduled_at: input.scheduledAt })
    .eq('id', input.matchId)
  if (error) throw new Error(`Failed to save the time: ${error.message}`)

  await notifyMatchScheduled(input.matchId, input.actorProfileId)
  await syncMatchToDiscord(input.matchId, input.origin)
}

/** The bot's reply once the time is saved; Discord shows each reader their own time zone. */
export function setTimeConfirmation(pairing: string, unix: number, moved: boolean): string {
  return (
    `🕒 **${pairing}** is ${moved ? 'moved to' : 'set for'} <t:${unix}:F> (<t:${unix}:R>).\n` +
    'The match page, the Discord event and the schedule post are updated.'
  )
}
