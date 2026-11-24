import { supabaseAdmin } from '$lib/supabase/admin'
import { combinePickemSeasonTotals, normalizePickemFormat } from '$lib/pickems'
import {
  getPickemResults,
  getPublishedPickemContextBySeasonId,
  listPickemPublicSubmissions,
} from '$lib/server/pickems'
import { cardRoot, COLORS, h, headerRow, INNER_WIDTH, type Node } from './kit'

/**
 * The final standings of one pick'em: the winner (or everyone tied for first)
 * and the top of the leaderboard. Drawn as the image on the Discord "Final"
 * announcement, at /og/pickem/[eventId].png.
 */

export type PickemFinalEntry = { rank: number; name: string; score: number }

export type PickemFinalData = {
  eventId: string
  seasonId: string
  seasonCode: string
  seasonName: string
  title: string
  status: string
  winners: PickemFinalEntry[]
  /** The top of the leaderboard, ties included, at least five rows when there are that many players. */
  board: PickemFinalEntry[]
  players: number
}

const MIN_SHOWN = 5
const MAX_SHOWN = 8

/** Rows to show: the top five, plus anyone tied with fifth, capped at eight. */
export function topOfBoard(ranked: PickemFinalEntry[]): PickemFinalEntry[] {
  if (ranked.length <= MIN_SHOWN) return ranked
  const cutoff = ranked[MIN_SHOWN - 1].rank
  return ranked.filter((e, i) => i < MIN_SHOWN || e.rank === cutoff).slice(0, MAX_SHOWN)
}

/** The final standings of a pick'em event, or null for an unknown or unpublished one. */
export async function loadPickemFinal(eventId: string): Promise<PickemFinalData | null> {
  const { data: row } = await supabaseAdmin
    .from('pickem_events')
    .select('id, season_id, format')
    .eq('id', eventId)
    .maybeSingle()
  if (!row) return null
  const ctx = await getPublishedPickemContextBySeasonId(
    row.season_id as string,
    normalizePickemFormat(row.format)
  )
  if (!ctx.event || ctx.event.id !== eventId) return null

  const { actualWinners } = await getPickemResults(ctx.event, ctx.matches)
  const submissions = await listPickemPublicSubmissions(ctx.event.id, ctx.matches, actualWinners)
  // One board: this gives the shared ranking (ties share a rank, earlier entries first).
  const ranked = combinePickemSeasonTotals([submissions])
    .filter((e) => e.score > 0)
    .map((e) => ({ rank: e.rank, name: e.user.name, score: e.score }))

  return {
    eventId,
    seasonId: ctx.season.id,
    seasonCode: ctx.season.code,
    seasonName: ctx.season.name.replace(/\s+/g, ' '),
    title: ctx.event.title?.trim() || `${ctx.season.name} Pick’em`,
    status: ctx.event.status,
    winners: ranked.filter((e) => e.rank === 1),
    board: topOfBoard(ranked),
    players: submissions.length,
  }
}

// ── Rendering ───────────────────────────────────────────────────────────────

const GAP = 32
const LEFT = 420
const RIGHT = INNER_WIDTH - LEFT - GAP
const ROW_PAD = 24

function ellipsis(width: number): Record<string, unknown> {
  return { maxWidth: width, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }
}

function rankColor(rank: number): string {
  return rank === 1
    ? COLORS.gold
    : rank === 2
      ? COLORS.silver
      : rank === 3
        ? COLORS.bronze
        : COLORS.faint
}

function winnerPanel(card: PickemFinalData): Node {
  const inner = LEFT - 36 * 2
  const names = card.winners.slice(0, 4)
  const more = card.winners.length - names.length
  const nameSize = names.length <= 1 ? 52 : names.length === 2 ? 42 : 34
  return h(
    'div',
    {
      width: inner,
      height: 440,
      flexDirection: 'column',
      justifyContent: 'center',
      gap: 18,
      padding: '0 36px',
      borderRadius: 24,
      backgroundColor: COLORS.panel,
    },
    h(
      'div',
      { fontSize: 26, fontWeight: 700, letterSpacing: 4, color: COLORS.gold },
      card.winners.length > 1 ? 'CO-CHAMPIONS' : 'CHAMPION'
    ),
    names.length === 0
      ? h('div', { fontSize: 40, fontWeight: 700 }, 'No winner')
      : h(
          'div',
          { flexDirection: 'column', gap: 6 },
          ...names.map((w) =>
            h('div', { fontSize: nameSize, fontWeight: 700, ...ellipsis(inner) }, w.name)
          ),
          more > 0 ? h('div', { fontSize: 26, color: COLORS.muted }, `+${more} more`) : null
        ),
    names[0]
      ? h('div', { fontSize: 30, fontWeight: 700, color: COLORS.accent }, `${names[0].score} pts`)
      : null,
    h('div', { fontSize: 22, color: COLORS.faint }, `${card.players} players`)
  )
}

function boardRow(entry: PickemFinalEntry, height: number): Node {
  const inner = RIGHT - ROW_PAD * 2
  const nameWidth = inner - 60 - 150 - 20 * 2
  return h(
    'div',
    {
      width: inner,
      height,
      alignItems: 'center',
      gap: 20,
      padding: `0 ${ROW_PAD}px`,
      borderRadius: 16,
      backgroundColor: COLORS.panel,
    },
    h(
      'div',
      { width: 60, fontSize: 30, fontWeight: 700, color: rankColor(entry.rank) },
      String(entry.rank)
    ),
    h(
      'div',
      { width: nameWidth, fontSize: 30, fontWeight: 700, ...ellipsis(nameWidth) },
      entry.name
    ),
    h(
      'div',
      { width: 150, justifyContent: 'flex-end', fontSize: 30, fontWeight: 700 },
      `${entry.score} pts`
    )
  )
}

export function buildPickemFinalCard(card: PickemFinalData): Node {
  const label = `Pick’em final · ${card.seasonName}`
  if (card.board.length === 0) {
    return cardRoot(
      {},
      headerRow(label),
      h(
        'div',
        { flexDirection: 'column', alignItems: 'center', gap: 20 },
        h('div', { fontSize: 72, fontWeight: 700 }, card.title),
        h('div', { fontSize: 32, color: COLORS.muted }, 'No picks scored any points.')
      ),
      h('div', { height: 34 })
    )
  }
  const gap = 10
  const rowHeight = Math.min(
    76,
    Math.floor((440 - gap * (card.board.length - 1)) / card.board.length)
  )
  return cardRoot(
    {},
    headerRow(label),
    h(
      'div',
      { gap: GAP, alignItems: 'center' },
      winnerPanel(card),
      h(
        'div',
        { flexDirection: 'column', gap, width: RIGHT },
        ...card.board.map((entry) => boardRow(entry, rowHeight))
      )
    )
  )
}
