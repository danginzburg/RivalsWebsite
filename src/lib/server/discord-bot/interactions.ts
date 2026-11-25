import { supabaseAdmin } from '$lib/supabase/admin'
import { loadActiveSeasonTeams, siteOrigin } from '$lib/server/discord-events/sync'
import { matchUrl, parseMatchTitle } from '$lib/server/discord-events/plan'
import { LINK_MATCH, SET_TIME } from './commands'
import { editOriginalResponse } from '$lib/server/discord-events/api'
import { inBackground } from '$lib/server/discord/announce'
import { profileForDiscordUser } from '$lib/server/discord-events/sync'
import {
  eveningTimeChoices,
  parseClock,
  parseDay,
  parseMatchTime,
  upcomingDayChoices,
} from './central-time'
import {
  loadSettableMatch,
  matchForThread,
  setMatchTime,
  setTimeConfirmation,
  setTimeProblem,
} from './set-time'
import { saveMatchVeto } from '$lib/server/matches/reports'
import {
  linkThreadToMatch,
  loadCursor,
  loadMatchVeto,
  loadOpenMatches,
  NO_PROMPT,
  saveCursor,
  schedulingForumId,
} from './thread-sync'
import {
  canAnswerVetoPrompt,
  canSetMatchTime,
  filterMatchChoices,
  matchChoiceLabel,
  parseTimeButtonId,
  parseVetoButtonId,
  sameLines,
  timeProposalClosed,
  timeProposalMessage,
  vetoPromptClosed,
  type ThreadMatch,
} from './threads'

/**
 * Answers to the interactions Discord POSTs to /api/discord/interactions.
 * https://discord.com/developers/docs/interactions/receiving-and-responding
 */

export const InteractionType = { Ping: 1, Command: 2, Component: 3, Autocomplete: 4 } as const

const Response = {
  Pong: 1,
  Message: 4,
  DeferredMessage: 5,
  DeferredUpdate: 6,
  UpdateMessage: 7,
  AutocompleteResult: 8,
} as const

/** Only the person who ran the command sees the reply. */
const EPHEMERAL = 1 << 6

/** Discord's channel types for public and private threads. */
const THREAD_TYPES = new Set([11, 12])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Option = { name: string; type: number; value?: unknown; focused?: boolean }

export type Interaction = {
  type: number
  /** For editing a deferred reply. */
  application_id?: string
  token?: string
  data?: { name?: string; options?: Option[]; custom_id?: string }
  channel_id?: string
  /** Who clicked or typed, with their permissions in this channel. */
  member?: { user?: { id?: string }; permissions?: string }
  channel?: { id: string; type: number; name?: string; parent_id?: string | null }
}

export type InteractionResponse = { type: number; data?: Record<string, unknown> }

function reply(content: string, ephemeral = false): InteractionResponse {
  return {
    type: Response.Message,
    data: { content, flags: ephemeral ? EPHEMERAL : 0, allowed_mentions: { parse: [] } },
  }
}

/**
 * Why `/link-match` can't run in this channel, or null if it can: it has to
 * be a thread, and a thread of the scheduling forum when one is configured.
 */
export function linkMatchChannelProblem(
  channel: Interaction['channel'],
  forumId: string | null
): string | null {
  if (!channel || !THREAD_TYPES.has(channel.type)) {
    return 'Run `/link-match` inside the match’s scheduling thread.'
  }
  if (forumId && channel.parent_id !== forumId) {
    return 'Run `/link-match` inside a thread in the match scheduling forum.'
  }
  return null
}

/** Put matches the thread's title names first, so the right one is at the top. */
async function orderForThread(matches: ThreadMatch[], threadName: string | undefined) {
  if (!threadName) return matches
  const pair = parseMatchTitle(threadName, await loadActiveSeasonTeams())
  if (!pair) return matches
  const ids = new Set([pair[0].id, pair[1].id])
  const named = (m: ThreadMatch) =>
    Boolean(m.team_a && m.team_b && ids.has(m.team_a.id) && ids.has(m.team_b.id))
  return [...matches.filter(named), ...matches.filter((m) => !named(m))]
}

async function autocompleteLinkMatch(interaction: Interaction): Promise<InteractionResponse> {
  const focused = interaction.data?.options?.find((o) => o.focused)
  const query = typeof focused?.value === 'string' ? focused.value : ''
  const matches = await orderForThread(await loadOpenMatches(), interaction.channel?.name)
  const choices = filterMatchChoices(matches, query)
    .slice(0, 25)
    .map((m) => ({ name: matchChoiceLabel(m), value: m.id }))
  return { type: Response.AutocompleteResult, data: { choices } }
}

function optionValue(interaction: Interaction, name: string): string {
  const value = interaction.data?.options?.find((o) => o.name === name)?.value
  return typeof value === 'string' ? value.trim() : ''
}

/** Day and time pickers for /set-time; anything typed that reads as a day or time is offered first. */
function autocompleteSetTime(interaction: Interaction): InteractionResponse {
  const focused = interaction.data?.options?.find((o) => o.focused)
  const typed = typeof focused?.value === 'string' ? focused.value.trim() : ''
  const lower = typed.toLowerCase()
  const now = new Date()
  const list = focused?.name === 'time' ? eveningTimeChoices() : upcomingDayChoices(now)
  const readable = typed && (focused?.name === 'time' ? parseClock(typed) : parseDay(typed, now))
  const choices = [
    ...(readable ? [{ name: typed.slice(0, 100), value: typed.slice(0, 100) }] : []),
    ...list.filter((c) => !lower || c.name.toLowerCase().includes(lower)),
  ].slice(0, 25)
  return { type: Response.AutocompleteResult, data: { choices } }
}

/**
 * Checks that are quick (where, what was typed) answer at once and privately.
 * Staff set the time straight away: the save runs after a deferred reply,
 * since it also updates the Discord event and the schedule post, then fills
 * the reply in. Anyone else proposes it: the bot posts the time with Approve
 * and Reject buttons for staff (see `answerTimeProposal`).
 */
async function runSetTime(
  interaction: Interaction,
  requestOrigin: string
): Promise<InteractionResponse> {
  const threadId = interaction.channel_id ?? interaction.channel?.id
  if (!threadId || !interaction.channel || ![11, 12].includes(interaction.channel.type)) {
    return reply('Run `/set-time` inside the match’s scheduling thread.', true)
  }
  const matchId = await matchForThread(threadId)
  if (!matchId) {
    return reply('This thread isn’t linked to a match yet. Run `/link-match` first.', true)
  }
  const match = await loadSettableMatch(matchId)
  const problem = setTimeProblem(match)
  if (problem) return reply(problem, true)

  const parsed = parseMatchTime(
    optionValue(interaction, 'date'),
    optionValue(interaction, 'time'),
    new Date()
  )
  if (!parsed.ok) return reply(parsed.error, true)

  if (!canSetMatchTime(interaction.member)) {
    const proposal = timeProposalMessage(
      match!.pairing,
      matchId,
      parsed.unix,
      interaction.member?.user?.id ?? null
    )
    return { type: Response.Message, data: { ...proposal } }
  }

  const { application_id: appId, token } = interaction
  if (!appId || !token) return reply('Discord sent an incomplete request. Try again.', true)

  const moved = Boolean(match!.scheduled_at)
  inBackground('set match time', async () => {
    let content: string
    try {
      await setMatchTime({
        matchId,
        scheduledAt: parsed.iso,
        actorProfileId: await profileForDiscordUser(interaction.member?.user?.id),
        origin: siteOrigin(requestOrigin),
      })
      content = setTimeConfirmation(match!.pairing, parsed.unix, moved)
    } catch (err) {
      console.error('set-time failed:', err)
      content = 'Something went wrong saving the time. Nothing was changed; try again in a minute.'
    }
    await editOriginalResponse(appId, token, { content, allowed_mentions: { parse: [] } })
  })
  return { type: Response.DeferredMessage }
}

async function runLinkMatch(
  interaction: Interaction,
  requestOrigin: string
): Promise<InteractionResponse> {
  const problem = linkMatchChannelProblem(interaction.channel, schedulingForumId())
  if (problem) return reply(problem, true)

  const value = interaction.data?.options?.find((o) => o.name === 'match')?.value
  const matchId = typeof value === 'string' ? value.trim() : ''
  if (!UUID_RE.test(matchId)) {
    return reply('Pick a match from the list as you type.', true)
  }

  const { data: match } = await supabaseAdmin
    .from('matches')
    .select(
      `id, approval_status,
       team_a:teams!matches_team_a_id_fkey (name),
       team_b:teams!matches_team_b_id_fkey (name)`
    )
    .eq('id', matchId)
    .maybeSingle()
  if (!match || match.approval_status !== 'approved') {
    return reply('That match isn’t on the site.', true)
  }

  await linkThreadToMatch(interaction.channel!.id, matchId)

  const name = (rel: unknown) =>
    (Array.isArray(rel) ? rel[0]?.name : (rel as { name?: string } | null)?.name) ?? 'TBD'
  const url = matchUrl(siteOrigin(requestOrigin), matchId)
  return reply(
    `🔗 Linked this thread to **${name(match.team_a)} vs ${name(match.team_b)}**: ${url}\n` +
      'Schedule updates for the match will post here, and a veto log pasted here is copied to the match.'
  )
}

/**
 * Approve or Reject on a time proposal (staff only). The button names the
 * match and the time, so it can't apply to another match if the thread is
 * re-linked; a time that has passed, or a match that's over, can't be approved.
 */
async function answerTimeProposal(
  interaction: Interaction,
  requestOrigin: string
): Promise<InteractionResponse> {
  const button = parseTimeButtonId(interaction.data?.custom_id ?? '')
  const threadId = interaction.channel_id ?? interaction.channel?.id
  if (!button || !threadId) return reply('This button isn’t supported.', true)
  if (!canSetMatchTime(interaction.member)) {
    return reply(
      'Only staff (Manage Threads, Manage Events or Administrator) can answer this.',
      true
    )
  }
  const userId = interaction.member?.user?.id ?? null
  const match = await loadSettableMatch(button.matchId)
  const pairing = match?.pairing ?? 'this match'

  if (button.action === 'reject') {
    return closePrompt(timeProposalClosed('rejected', button.unix, pairing, userId))
  }

  const stale = (detail: string) =>
    closePrompt(timeProposalClosed('stale', button.unix, pairing, null, detail))
  const problem = setTimeProblem(match)
  if (problem) return stale(problem.replace(/.$/, '').toLowerCase())
  if ((await matchForThread(threadId)) !== button.matchId) {
    return stale('this thread is linked to a different match now')
  }
  if (button.unix * 1000 <= Date.now()) return stale('that time has passed')

  const { application_id: appId, token } = interaction
  if (!appId || !token) return reply('Discord sent an incomplete request. Try again.', true)

  inBackground('approve match time', async () => {
    let body: unknown
    try {
      await setMatchTime({
        matchId: button.matchId,
        scheduledAt: new Date(button.unix * 1000).toISOString(),
        actorProfileId: await profileForDiscordUser(userId ?? undefined),
        origin: siteOrigin(requestOrigin),
      })
      body = timeProposalClosed('approved', button.unix, pairing, userId)
    } catch (err) {
      console.error('approve match time failed:', err)
      // Leave the buttons up so it can be tried again.
      body = {
        content: `${timeProposalMessage(pairing, button.matchId, button.unix, null).content}
⚠️ Saving failed; nothing was changed. Try again in a minute.`,
      }
    }
    await editOriginalResponse(appId, token, body)
  })
  return { type: Response.DeferredUpdate }
}

/** Replace the prompt that holds the button. */
function closePrompt(data: { content: string } & Record<string, unknown>): InteractionResponse {
  return { type: Response.UpdateMessage, data }
}

/**
 * "Update veto" or "Keep current" on a veto prompt. The button carries a
 * fingerprint of the veto it was shown with; if the thread has moved on since,
 * the button no longer applies.
 */
async function answerVetoPrompt(interaction: Interaction): Promise<InteractionResponse> {
  const button = parseVetoButtonId(interaction.data?.custom_id ?? '')
  const threadId = interaction.channel_id ?? interaction.channel?.id
  if (!button || !threadId) return reply('This button isn’t supported.', true)

  const cursor = await loadCursor(threadId)
  const pending = cursor?.pending_lines ?? []
  if (!cursor?.match_id || pending.length === 0 || cursor.pending_hash !== button.hash) {
    return closePrompt(vetoPromptClosed('withdrawn', null))
  }
  if (!canAnswerVetoPrompt(interaction.member, cursor.pending_author_id)) {
    const who = cursor.pending_author_id ? `<@${cursor.pending_author_id}> or staff` : 'Staff'
    return reply(`Only ${who} can answer this.`, true)
  }
  const userId = interaction.member?.user?.id ?? null

  if (button.action === 'keep') {
    await saveCursor({ ...cursor, ...NO_PROMPT, dismissed_lines: pending })
    return closePrompt(vetoPromptClosed('kept', userId))
  }

  const current = await loadMatchVeto(cursor.match_id)
  // An admin typed a veto on the site since the prompt went up: theirs stands.
  if (current == null || (current.length > 0 && !sameLines(current, cursor.imported_lines))) {
    await saveCursor({ ...cursor, ...NO_PROMPT })
    return closePrompt(vetoPromptClosed('withdrawn', null))
  }
  await saveMatchVeto(cursor.match_id, pending)
  await saveCursor({ ...cursor, ...NO_PROMPT, imported_lines: pending })
  return closePrompt(vetoPromptClosed('updated', userId, pending))
}

export async function handleInteraction(
  interaction: Interaction,
  requestOrigin: string
): Promise<InteractionResponse> {
  if (interaction.type === InteractionType.Ping) return { type: Response.Pong }
  if (interaction.type === InteractionType.Component) {
    if (interaction.data?.custom_id?.startsWith('time:')) {
      return answerTimeProposal(interaction, requestOrigin)
    }
    return answerVetoPrompt(interaction)
  }

  const command = interaction.data?.name
  if (command === LINK_MATCH.name) {
    if (interaction.type === InteractionType.Autocomplete) {
      return autocompleteLinkMatch(interaction)
    }
    if (interaction.type === InteractionType.Command) {
      return runLinkMatch(interaction, requestOrigin)
    }
  }
  if (command === SET_TIME.name) {
    if (interaction.type === InteractionType.Autocomplete) return autocompleteSetTime(interaction)
    if (interaction.type === InteractionType.Command) return runSetTime(interaction, requestOrigin)
  }
  return reply('This command isn’t supported.', true)
}
