import satori from 'satori'
import sharp from 'sharp'
import { read } from '$app/server'
import { supabaseAdmin } from '$lib/supabase/admin'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { leagueTime, SITE_NAME } from '$lib/meta'
import boldFontUrl from './fonts/Nippo-Bold.ttf'
import regularFontUrl from './fonts/Nippo-Regular.ttf'

/**
 * The 1200×630 scorecard Discord shows as a match link's preview image:
 * both teams, the series score (or the start time), and the maps.
 *
 * satori lays out a small tree of plain objects into SVG with the text turned
 * into shapes, so the server needs no fonts installed; sharp turns that into a
 * PNG and also converts the teams' WebP logos, which satori cannot read.
 */

export const CARD_WIDTH = 1200
export const CARD_HEIGHT = 630

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

type Node = { type: string; props: Record<string, unknown> }

/** A satori element. Children may be nodes, strings, or falsy (skipped). */
function h(
  type: string,
  style: Record<string, unknown>,
  ...children: Array<Node | string | null | false | undefined>
): Node {
  const kids = children.filter((c): c is Node | string => !!c)
  return {
    type,
    props: { style: { display: 'flex', ...style }, children: kids.length === 1 ? kids[0] : kids },
  }
}

function img(src: string, size: number): Node {
  return {
    type: 'img',
    props: {
      src,
      width: size,
      height: size,
      style: { width: size, height: size, objectFit: 'contain' },
    },
  }
}

let fontCache: Promise<Array<{ name: string; data: ArrayBuffer; weight: 400 | 700 }>> | null = null

function loadFonts() {
  fontCache ??= Promise.all([
    read(regularFontUrl).arrayBuffer(),
    read(boldFontUrl).arrayBuffer(),
  ]).then(([regular, bold]) => [
    { name: 'Nippo', data: regular, weight: 400 as const },
    { name: 'Nippo', data: bold, weight: 700 as const },
  ])
  return fontCache
}

/** A team logo as a PNG data URI satori can draw, or null if it cannot be fetched. */
async function logoDataUri(url: string | null, size: number): Promise<string | null> {
  if (!url) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return null
    const png = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
    return `data:image/png;base64,${png.toString('base64')}`
  } catch {
    return null
  }
}

const PAD_X = 56
const PAD_Y = 44
/* Two team columns plus the centre fit inside the padding (1200 − 2×56). */
const TEAM_WIDTH = 330
const CENTRE_WIDTH = 380

const COLORS = {
  text: '#ffffff',
  muted: 'rgba(236, 228, 248, 0.62)',
  faint: 'rgba(236, 228, 248, 0.35)',
  accent: '#c084fc',
  good: '#86efac',
  panel: 'rgba(0, 0, 0, 0.28)',
}

function teamBlock(side: Side, logo: string | null, won: boolean | null): Node {
  const initials = (side.tag || side.name).slice(0, 3).toUpperCase()
  return h(
    'div',
    { flexDirection: 'column', alignItems: 'center', width: TEAM_WIDTH, gap: 22 },
    logo
      ? img(logo, 200)
      : h(
          'div',
          {
            width: 200,
            height: 200,
            borderRadius: 28,
            backgroundColor: '#512f8a',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 64,
            fontWeight: 700,
            color: '#ece4f8',
          },
          initials
        ),
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

/** Render the scorecard to a PNG. */
export async function renderMatchCard(card: MatchCardData): Promise<Buffer> {
  return sharp(Buffer.from(await renderMatchCardSvg(card)))
    .png()
    .toBuffer()
}

/** The scorecard as SVG (satori's output, before rasterising). */
export async function renderMatchCardSvg(card: MatchCardData): Promise<string> {
  const [fonts, logoA, logoB] = await Promise.all([
    loadFonts(),
    logoDataUri(card.teamA.logo, 400),
    logoDataUri(card.teamB.logo, 400),
  ])

  const played = card.status === 'completed'
  const tree = h(
    'div',
    {
      // satori adds padding outside the root's size, so the size excludes it.
      width: CARD_WIDTH - PAD_X * 2,
      height: CARD_HEIGHT - PAD_Y * 2,
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: `${PAD_Y}px ${PAD_X}px`,
      fontFamily: 'Nippo',
      color: COLORS.text,
      backgroundImage: 'linear-gradient(135deg, #1a1b25 0%, #2b1a4a 55%, #392061 100%)',
    },
    // Event line + brand
    h(
      'div',
      { justifyContent: 'space-between', alignItems: 'center' },
      h(
        'div',
        { fontSize: 28, fontWeight: 700, letterSpacing: 3, color: COLORS.muted },
        (card.event ?? 'Match').toUpperCase()
      ),
      h('div', { fontSize: 28, fontWeight: 700, color: COLORS.accent }, SITE_NAME)
    ),
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

  return satori(tree as unknown as Parameters<typeof satori>[0], {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts,
  })
}
