import { supabaseAdmin } from '$lib/supabase/admin'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { loadSeasonFinalPlacements } from '$lib/server/seasons/finalPlacements'
import { finishLabel } from '$lib/format/finish'
import { cardRoot, COLORS, h, headerRow, INNER_WIDTH, logoDataUri, picture, type Node } from './kit'

/**
 * The team page's preview card: logo, name and tag, season, series record,
 * final finish once the season is over, and the roster along the bottom.
 */

export type TeamCardData = {
  name: string
  tag: string | null
  logo: string | null
  season: string | null
  wins: number
  losses: number
  /** "Champion", "3rd"…, once the season is over. */
  finish: string | null
  teamCount: number | null
  roster: string[]
}

type SeasonRel = { name: string | null }

/** Everything the card shows, or null for a team visitors cannot see. */
export async function loadTeamCard(teamId: string): Promise<TeamCardData | null> {
  const { data: team } = await supabaseAdmin
    .from('teams')
    .select(
      'id, name, tag, logo_path, approval_status, season_id, season:seasons!teams_season_id_fkey (name)'
    )
    .eq('id', teamId)
    .maybeSingle()
  if (!team || team.approval_status !== 'approved') return null

  const [{ data: matches }, { data: memberships }, final] = await Promise.all([
    supabaseAdmin
      .from('matches')
      .select('winner_team_id')
      .eq('status', 'completed')
      .eq('approval_status', 'approved')
      .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`),
    supabaseAdmin
      .from('team_memberships')
      .select('profile_id, player_name, role, profiles (display_name)')
      .eq('team_id', teamId)
      .eq('is_active', true)
      .is('left_at', null)
      .order('joined_at', { ascending: true, nullsFirst: false }),
    team.season_id ? loadSeasonFinalPlacements(team.season_id) : Promise.resolve(null),
  ])

  const one = <T>(rel: T | T[] | null): T | null => (Array.isArray(rel) ? (rel[0] ?? null) : rel)
  const season = one(team.season as SeasonRel | SeasonRel[] | null)
  const played = matches ?? []
  const placement = final?.finished ? final.placements[teamId] : undefined

  // Captain first, then everyone else in the order they joined.
  type MemberRow = {
    player_name: string | null
    role: string | null
    profiles: { display_name: string | null } | { display_name: string | null }[] | null
  }
  const members = (memberships ?? []) as MemberRow[]
  const ordered = [
    ...members.filter((m) => m.role === 'captain'),
    ...members.filter((m) => m.role !== 'captain'),
  ]
  const roster = [
    ...new Set(
      ordered
        .map((m) => one(m.profiles)?.display_name ?? m.player_name)
        .filter((n): n is string => !!n?.trim())
        .map((n) => n.trim())
    ),
  ]

  return {
    name: team.name,
    tag: team.tag ?? null,
    logo: getTeamLogoUrl(team),
    season: season?.name?.replace(/\s+/g, ' ') ?? null,
    wins: played.filter((m) => m.winner_team_id === teamId).length,
    losses: played.filter((m) => m.winner_team_id && m.winner_team_id !== teamId).length,
    finish: placement ? finishLabel(placement) : null,
    teamCount: placement && final ? final.teamCount : null,
    roster,
  }
}

// ── Rendering ───────────────────────────────────────────────────────────────

const LOGO = 230
const GAP = 52
const INFO_WIDTH = INNER_WIDTH - LOGO - GAP
const MAX_ROSTER = 8

function chip(label: string, value: string, color: string = COLORS.text): Node {
  return h(
    'div',
    {
      flexDirection: 'column',
      padding: '12px 24px',
      borderRadius: 16,
      backgroundColor: COLORS.panel,
      gap: 4,
    },
    h(
      'div',
      { fontSize: 18, fontWeight: 700, letterSpacing: 3, color: COLORS.muted },
      label.toUpperCase()
    ),
    h('div', { fontSize: 38, fontWeight: 700, lineHeight: 1, color }, value)
  )
}

function rosterRow(roster: string[]): Node {
  if (roster.length === 0) return h('div', { height: 48 })
  const shown = roster.slice(0, MAX_ROSTER)
  const more = roster.length - shown.length
  // Shrink the names when a long roster would not fit two lines.
  const size = roster.join('').length > 70 ? 22 : 26
  return h(
    'div',
    { flexWrap: 'wrap', gap: 10, maxHeight: 108, overflow: 'hidden', width: INNER_WIDTH },
    ...shown.map((name) =>
      h(
        'div',
        {
          padding: '8px 18px',
          borderRadius: 999,
          backgroundColor: COLORS.panel,
          fontSize: size,
          color: COLORS.text,
        },
        name
      )
    ),
    more > 0 &&
      h('div', { padding: '8px 6px', fontSize: size, color: COLORS.faint }, `+${more} more`)
  )
}

export async function buildTeamCard(card: TeamCardData): Promise<Node> {
  const logo = await logoDataUri(card.logo, LOGO * 2)
  const nameSize = card.name.length > 22 ? 52 : card.name.length > 14 ? 62 : 76
  const champion = card.finish === 'Champion'

  return cardRoot(
    {},
    headerRow(card.season ?? 'Team'),
    h(
      'div',
      { alignItems: 'center', gap: GAP },
      picture(logo, card.tag || card.name, LOGO),
      h(
        'div',
        { flexDirection: 'column', width: INFO_WIDTH, gap: 20 },
        h(
          'div',
          { alignItems: 'baseline', flexWrap: 'wrap', gap: 18, maxWidth: INFO_WIDTH },
          h('div', { fontSize: nameSize, fontWeight: 700, lineHeight: 1.05 }, card.name),
          card.tag && h('div', { fontSize: 34, fontWeight: 700, color: COLORS.faint }, card.tag)
        ),
        h(
          'div',
          { gap: 16 },
          card.wins + card.losses > 0 && chip('Series', `${card.wins}–${card.losses}`),
          card.finish &&
            chip(
              'Finish',
              champion || !card.teamCount ? card.finish : `${card.finish} of ${card.teamCount}`,
              champion ? COLORS.gold : COLORS.text
            )
        )
      )
    ),
    rosterRow(card.roster)
  )
}
