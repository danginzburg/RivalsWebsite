import type { StandingsRow } from '$lib/server/leaderboard/standings'
import { cardRoot, COLORS, h, headerRow, INNER_WIDTH, logoDataUri, picture, type Node } from './kit'

/**
 * The leaderboard's preview card: the top eight of the running season's
 * standings in two columns, or a note between seasons.
 */

export type LeaderboardCardData = {
  season: string | null
  rows: Array<{
    rank: number | null
    name: string
    tag: string | null
    logo: string | null
    wins: number
    losses: number
    mapWins: number
    mapLosses: number
    roundDiff: number
  }>
}

const SHOWN = 8

export function leaderboardCardData(standings: {
  season: { name: string | null } | null
  rows: StandingsRow[]
}): LeaderboardCardData {
  return {
    season: standings.season?.name?.replace(/\s+/g, ' ') ?? null,
    rows: standings.rows
      .filter((r) => r.stats && !r.disbanded)
      .slice(0, SHOWN)
      .map((r) => ({
        rank: r.stats!.rank,
        name: r.name,
        tag: r.tag,
        logo: r.logo_url,
        wins: r.stats!.series_wins,
        losses: r.stats!.series_losses,
        mapWins: r.stats!.map_wins,
        mapLosses: r.stats!.map_losses,
        roundDiff: r.stats!.round_diff,
      })),
  }
}

// ── Rendering ───────────────────────────────────────────────────────────────

const COLUMN_GAP = 28
const COLUMN = Math.floor((INNER_WIDTH - COLUMN_GAP) / 2)
const ROW_HEIGHT = 98
const LOGO = 62
const RANK = 46
const RECORD = 124
const ROW_PAD = 26

function row(r: LeaderboardCardData['rows'][number], index: number, logo: string | null): Node {
  // Padding sits outside the width (see kit.ts), so the row's width leaves it out.
  const inner = COLUMN - ROW_PAD * 2
  const nameWidth = inner - RANK - LOGO - RECORD - 18 * 3
  const rd = r.roundDiff > 0 ? `+${r.roundDiff}` : String(r.roundDiff)
  const rank = r.rank ?? index + 1
  return h(
    'div',
    {
      width: inner,
      height: ROW_HEIGHT,
      alignItems: 'center',
      gap: 18,
      padding: `0 ${ROW_PAD}px`,
      borderRadius: 18,
      backgroundColor: COLORS.panel,
    },
    h(
      'div',
      {
        width: RANK,
        fontSize: 34,
        fontWeight: 700,
        color: rank === 1 ? COLORS.gold : COLORS.faint,
      },
      r.rank != null ? String(r.rank) : '–'
    ),
    picture(logo, r.tag || r.name, LOGO),
    h(
      'div',
      { flexDirection: 'column', width: nameWidth, gap: 4 },
      h(
        'div',
        {
          fontSize: 32,
          fontWeight: 700,
          maxWidth: nameWidth,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
        },
        // Tags keep the rows short; a team without one falls back to its name.
        r.tag || r.name
      ),
      h('div', { fontSize: 20, color: COLORS.faint }, `Maps ${r.mapWins}–${r.mapLosses} · ${rd}`)
    ),
    h(
      'div',
      { width: RECORD, justifyContent: 'flex-end', fontSize: 38, fontWeight: 700 },
      `${r.wins}–${r.losses}`
    )
  )
}

export async function buildLeaderboardCard(card: LeaderboardCardData): Promise<Node> {
  const label = card.season ? `Standings · ${card.season}` : 'Standings'
  if (card.rows.length === 0) {
    return cardRoot(
      {},
      headerRow(label),
      h(
        'div',
        { flexDirection: 'column', alignItems: 'center', gap: 20 },
        h(
          'div',
          { fontSize: 72, fontWeight: 700 },
          card.season ? 'No results yet' : 'Between seasons'
        ),
        h(
          'div',
          { fontSize: 32, color: COLORS.muted },
          card.season
            ? 'The table fills in once the first matches are played.'
            : 'Standings return when the next season starts.'
        )
      ),
      h('div', { height: 34 })
    )
  }

  const logos = await Promise.all(card.rows.map((r) => logoDataUri(r.logo, LOGO * 2)))
  const rows = card.rows.map((r, i) => row(r, i, logos[i] ?? null))
  const half = Math.ceil(rows.length / 2)
  const column = (items: Node[]) =>
    h('div', { flexDirection: 'column', gap: 12, width: COLUMN }, ...items)

  return cardRoot(
    {},
    headerRow(label),
    h('div', { gap: COLUMN_GAP }, column(rows.slice(0, half)), column(rows.slice(half)))
  )
}
