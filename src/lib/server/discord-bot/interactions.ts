import { supabaseAdmin } from '$lib/supabase/admin'
import { loadActiveSeasonTeams, siteOrigin } from '$lib/server/discord-events/sync'
import { matchUrl, parseMatchTitle } from '$lib/server/discord-events/plan'
import { LINK_MATCH } from './commands'
import { linkThreadToMatch, loadOpenMatches, schedulingForumId } from './thread-sync'
import { filterMatchChoices, matchChoiceLabel, type ThreadMatch } from './threads'

/**
 * Answers to the interactions Discord POSTs to /api/discord/interactions.
 * https://discord.com/developers/docs/interactions/receiving-and-responding
 */

export const InteractionType = { Ping: 1, Command: 2, Autocomplete: 4 } as const

const Response = { Pong: 1, Message: 4, AutocompleteResult: 8 } as const

/** Only the person who ran the command sees the reply. */
const EPHEMERAL = 1 << 6

/** Discord's channel types for public and private threads. */
const THREAD_TYPES = new Set([11, 12])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Option = { name: string; type: number; value?: unknown; focused?: boolean }

export type Interaction = {
  type: number
  data?: { name?: string; options?: Option[] }
  channel_id?: string
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

export async function handleInteraction(
  interaction: Interaction,
  requestOrigin: string
): Promise<InteractionResponse> {
  if (interaction.type === InteractionType.Ping) return { type: Response.Pong }

  const command = interaction.data?.name
  if (command === LINK_MATCH.name) {
    if (interaction.type === InteractionType.Autocomplete) {
      return autocompleteLinkMatch(interaction)
    }
    if (interaction.type === InteractionType.Command) {
      return runLinkMatch(interaction, requestOrigin)
    }
  }
  return reply('This command isn’t supported.', true)
}
