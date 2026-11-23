import { supabaseAdmin } from '$lib/supabase/admin'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { leagueTime } from '$lib/meta'
import {
  cardRoot,
  COLORS,
  h,
  headerRow,
  img,
  logoDataUri,
  placeholder,
  renderCard,
  renderCardSvg,
  type Node,
} from './kit'

/**
 * The 1200×630 scorecard Discord shows as a match link's preview image:
 * both teams, the series score (or the start time), and the maps.
 */

type Side = { name: string; tag: string | null; logo: string | null }

export type MatchCardData = {
  event: string | null
  status: 'scheduled' | 'live' | 'completed' | 'cancelled'
  scheduledAt: string | null
  teamA: Side
  teamB: Side
  scoreA: number
  scoreB: number
  winner: 'a' | 'b' | null
  maps: Array<{ name: string; a: number; b: number }>
}

/** Everything the card shows, or null for a match visitors cannot see. */
export async function loadMatchCard(matchId: string): Promise<MatchCardData | null> {
  const { data: match } = await supabaseAdmin
    .from('matches')
    .select(
      `id, status, approval_status, scheduled_at, team_a_id, team_b_id, team_a_score, team_b_score,
       winner_team_id, metadata,
       season:seasons (name),
       team_a:teams!matches_team_a_id_fkey (id, name, tag, logo_path),
       team_b:teams!matches_team_b_id_fkey (id, name, tag, logo_path)`
    )
    .eq('id', matchId)
    .maybeSingle()
  if (!match || match.approval_status !== 'approved') return null

  const { data: maps } = await supabaseAdmin
    .from('match_maps')
    .select('map_order, map_name, team_a_rounds, team_b_rounds, is_voided')
    .eq('match_id', matchId)
    .order('map_order')

  const one = <T>(rel: T | T[] | null): T | null => (Array.isArray(rel) ? (rel[0] ?? null) : rel)
  type TeamRel = { id: string; name: string; tag: string | null; logo_path: string | null }
  const a = one(match.team_a as TeamRel | TeamRel[] | null)
  const b = one(match.team_b as TeamRel | TeamRel[] | null)
  const season = one(match.season as { name: string | null } | { name: string | null }[] | null)
  const designation = (match.metadata as { designation?: string } | null)?.designation ?? null

  return {
    event: [season?.name?.replace(/\s+/g, ' '), designation].filter(Boolean).join(' · ') || null,
    status: match.status as MatchCardData['status'],
    scheduledAt: match.scheduled_at,
    teamA: { name: a?.name ?? 'TBD', tag: a?.tag ?? null, logo: a ? getTeamLogoUrl(a) : null },
    teamB: { name: b?.name ?? 'TBD', tag: b?.tag ?? null, logo: b ? getTeamLogoUrl(b) : null },
    scoreA: match.team_a_score ?? 0,
    scoreB: match.team_b_score ?? 0,
    winner:
      match.winner_team_id && match.winner_team_id === match.team_a_id
        ? 'a'
        : match.winner_team_id && match.winner_team_id === match.team_b_id
          ? 'b'
          : null,
    maps: (maps ?? [])
      .filter(
        (m) => !m.is_voided && m.map_name && m.team_a_rounds != null && m.team_b_rounds != null
      )
      .map((m) => ({ name: m.map_name as string, a: m.team_a_rounds!, b: m.team_b_rounds! })),
  }
}

// ── Rendering ───────────────────────────────────────────────────────────────

/* Two team columns plus the centre fit inside the padding (1200 − 2×56). */
const TEAM_WIDTH = 330
const CENTRE_WIDTH = 380

function teamBlock(side: Side, logo: string | null, won: boolean | null): Node {
  const initials = (side.tag || side.name).slice(0, 3).toUpperCase()
  return h(
    'div',
    { flexDirection: 'column', alignItems: 'center', width: TEAM_WIDTH, gap: 22 },
    logo ? img(logo, 200) : placeholder(initials, 200),
    h(
      'div',
      {
        fontSize: side.name.length > 12 ? 32 : 40,
        // Room for two lines either way, so both logos stay level.
        height: 84,
        alignItems: 'flex-start',
        fontWeight: 700,
        color: won === false ? COLORS.muted : COLORS.text,
        textAlign: 'center',
        justifyContent: 'center',
        maxWidth: TEAM_WIDTH,
        lineHeight: 1.15,
      },
      side.name
    )
  )
}

function centre(card: MatchCardData): Node {
  if (card.status === 'completed') {
    const scoreStyle = (won: boolean) => ({
      fontSize: 130,
      fontWeight: 700,
      lineHeight: 1,
      color: won ? COLORS.text : COLORS.faint,
    })
    return h(
      'div',
      { flexDirection: 'column', alignItems: 'center', gap: 14, width: CENTRE_WIDTH },
      h(
        'div',
        { alignItems: 'center', gap: 30 },
        h('div', scoreStyle(card.winner === 'a'), String(card.scoreA)),
        h('div', { fontSize: 90, color: COLORS.faint, lineHeight: 1 }, '–'),
        h('div', scoreStyle(card.winner === 'b'), String(card.scoreB))
      ),
      h('div', { fontSize: 26, fontWeight: 700, letterSpacing: 6, color: COLORS.accent }, 'FINAL')
    )
  }
  const label =
    card.status === 'live' ? 'LIVE NOW' : card.status === 'cancelled' ? 'CANCELLED' : null
  return h(
    'div',
    { flexDirection: 'column', alignItems: 'center', gap: 22, width: CENTRE_WIDTH },
    h('div', { fontSize: 110, fontWeight: 700, color: COLORS.faint, lineHeight: 1 }, 'VS'),
    label
      ? h(
          'div',
          {
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: 4,
            color: card.status === 'live' ? '#fca5a5' : COLORS.muted,
          },
          label
        )
      : h(
          'div',
          { fontSize: 30, fontWeight: 400, color: COLORS.text, textAlign: 'center' },
          leagueTime(card.scheduledAt) ?? 'Time TBD'
        )
  )
}

function mapStrip(card: MatchCardData): Node | null {
  if (card.maps.length === 0) return null
  return h(
    'div',
    { gap: 16, justifyContent: 'center' },
    ...card.maps.slice(0, 5).map((m) =>
      h(
        'div',
        {
          alignItems: 'center',
          gap: 14,
          padding: '12px 22px',
          borderRadius: 14,
          backgroundColor: COLORS.panel,
          fontSize: 26,
        },
        h('div', { color: COLORS.muted, fontWeight: 400 }, m.name),
        h('div', { fontWeight: 700, color: COLORS.text }, `${m.a}–${m.b}`)
      )
    )
  )
}

function matchTree(card: MatchCardData, logoA: string | null, logoB: string | null): Node {
  const played = card.status === 'completed'
  return cardRoot(
    {},
    headerRow(card.event ?? 'Match'),
    // Teams and score
    h(
      'div',
      { justifyContent: 'space-between', alignItems: 'center' },
      teamBlock(card.teamA, logoA, played ? card.winner === 'a' : null),
      centre(card),
      teamBlock(card.teamB, logoB, played ? card.winner === 'b' : null)
    ),
    // Maps (or an empty spacer so the middle row stays centred)
    mapStrip(card) ?? h('div', { height: 58 })
  )
}

async function buildTree(card: MatchCardData): Promise<Node> {
  const [logoA, logoB] = await Promise.all([
    logoDataUri(card.teamA.logo, 400),
    logoDataUri(card.teamB.logo, 400),
  ])
  return matchTree(card, logoA, logoB)
}

/** Render the scorecard to a PNG. */
export async function renderMatchCard(card: MatchCardData): Promise<Buffer> {
  return renderCard(await buildTree(card))
}

/** The scorecard as SVG (satori's output, before rasterising). */
export async function renderMatchCardSvg(card: MatchCardData): Promise<string> {
  return renderCardSvg(await buildTree(card))
}
