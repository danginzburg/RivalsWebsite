import { supabaseAdmin } from '$lib/supabase/admin'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { statText } from '$lib/meta'
import { loadPlayerDirectory } from '$lib/server/players/directory'
import { listProfileRiotAccounts } from '$lib/server/players/riot-accounts'
import { loadTeamHistory, type TeamRel } from '$lib/server/players/team-history'
import {
  loadPeakRank,
  PROFILE_SEASON_COLUMNS,
  PROFILE_STAT_COLUMNS,
  selectProfileStats,
  type ProfileSeasonRow,
} from '$lib/server/players/profile-stat-selection'
import type { StatRow } from '$lib/server/players/profile-stats'
import { cardRoot, COLORS, h, headerRow, INNER_WIDTH, logoDataUri, picture, type Node } from './kit'

/**
 * The player profile's preview card: avatar, name, team, peak rank, and the
 * same headline stats the profile shows for the same stats table.
 */

export type PlayerCardData = {
  name: string
  avatar: string | null
  /** The current team, or the most recent one (with `teamNote` naming its season). */
  team: { name: string; logo: string | null } | null
  teamNote: string | null
  peakRank: string | null
  /** Which stats table the numbers come from, e.g. "Season 4 (Full)". */
  statsLabel: string | null
  stats: Array<{ label: string; value: string }>
}

type ActiveMembershipRow = {
  season_id?: string | null
  teams?: TeamRel | TeamRel[] | null
}

/** Everything the card shows, or null for an unknown profile. */
export async function loadPlayerCard(
  profileId: string,
  batchId: string | null
): Promise<PlayerCardData | null> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, email, discord_id, avatar_url')
    .eq('id', profileId)
    .maybeSingle()
  if (!profile) return null

  const [
    directory,
    { data: membershipRows },
    { data: activeSeason },
    { data: statsRows },
    { data: seasons },
    riotAccounts,
    teamHistory,
  ] = await Promise.all([
    loadPlayerDirectory([profileId]),
    supabaseAdmin
      .from('team_memberships')
      .select('season_id, teams (id, name, tag, logo_path, approval_status)')
      .eq('profile_id', profileId)
      .eq('is_active', true)
      .is('left_at', null),
    supabaseAdmin.from('seasons').select('id').eq('is_active', true).maybeSingle(),
    supabaseAdmin
      .from('rivals_group_stats')
      .select(PROFILE_STAT_COLUMNS)
      .eq('profile_id', profileId)
      .order('imported_at', { ascending: false })
      .limit(200),
    supabaseAdmin
      .from('seasons')
      .select(PROFILE_SEASON_COLUMNS)
      .order('starts_on', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
    listProfileRiotAccounts(profileId),
    loadTeamHistory(profileId),
  ])

  const { normalizedStats, selected } = await selectProfileStats(
    (statsRows ?? []) as StatRow[],
    (seasons ?? []) as ProfileSeasonRow[],
    batchId
  )
  const peakRank = await loadPeakRank(normalizedStats, riotAccounts)

  // The current team, chosen as the profile does: the active season's spot on an approved team.
  const membership = activeSeason?.id
    ? ((membershipRows ?? []) as ActiveMembershipRow[]).find(
        (row) => row.season_id === activeSeason.id
      )
    : null
  const teamRel = membership
    ? Array.isArray(membership.teams)
      ? membership.teams[0]
      : membership.teams
    : null
  let team: PlayerCardData['team'] = null
  let teamNote: string | null = null
  if (teamRel && (teamRel as { approval_status?: string }).approval_status === 'approved') {
    team = { name: teamRel.name, logo: getTeamLogoUrl(teamRel) }
  } else {
    // Between seasons nobody has a current team, so show where they last played.
    const last = teamHistory.find((row) => row.season_kind !== 'external') ?? teamHistory[0]
    if (last) {
      team = { name: last.team.name, logo: last.team.logo_url }
      teamNote = last.season?.name?.replace(/\s+/g, ' ') ?? null
    }
  }

  const stat = (label: string, value: string | null) => (value ? { label, value } : null)
  const stats = selected
    ? [
        stat('ACS', statText(selected.acs)),
        stat('K/D', statText(selected.kd, 2)),
        stat('KAST', statText(selected.kast_pct) && `${statText(selected.kast_pct)}%`),
        stat('Maps', statText(selected.games)),
      ].filter((s): s is { label: string; value: string } => s !== null)
    : []

  return {
    name: profile.display_name ?? directory.get(profileId)?.riot_name ?? profile.email ?? 'Player',
    avatar: profile.discord_id ? (profile.avatar_url ?? null) : null,
    team,
    teamNote,
    peakRank,
    statsLabel: stats.length
      ? ((selected?.batch?.display_name as string | undefined) ?? null)
      : null,
    stats,
  }
}

/** The parts of the card that change, for the page's `?v=`. */
export function playerCardVersionParts(card: PlayerCardData): unknown[] {
  return [
    card.name,
    card.avatar,
    card.team,
    card.teamNote,
    card.peakRank,
    card.statsLabel,
    card.stats,
  ]
}

// ── Rendering ───────────────────────────────────────────────────────────────

const AVATAR = 230
const GAP = 52
const INFO_WIDTH = INNER_WIDTH - AVATAR - GAP
const TILE_GAP = 20

function statTiles(stats: PlayerCardData['stats']): Node {
  if (stats.length === 0) {
    return h(
      'div',
      {
        height: 132,
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 30,
        color: COLORS.faint,
      },
      'No stats recorded yet'
    )
  }
  const width = Math.floor((INNER_WIDTH - TILE_GAP * 3) / 4)
  return h(
    'div',
    { gap: TILE_GAP },
    ...stats.map((s) =>
      h(
        'div',
        {
          width,
          height: 132,
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 6,
          borderRadius: 18,
          backgroundColor: COLORS.panel,
        },
        h('div', { fontSize: 58, fontWeight: 700, lineHeight: 1 }, s.value),
        h(
          'div',
          { fontSize: 22, fontWeight: 700, letterSpacing: 3, color: COLORS.muted },
          s.label.toUpperCase()
        )
      )
    )
  )
}

export async function buildPlayerCard(card: PlayerCardData): Promise<Node> {
  const [avatar, teamLogo] = await Promise.all([
    logoDataUri(card.avatar, AVATAR * 2, true),
    logoDataUri(card.team?.logo, 112),
  ])
  const nameSize = card.name.length > 18 ? 50 : card.name.length > 12 ? 62 : 76

  return cardRoot(
    {},
    headerRow(card.statsLabel ?? 'Player'),
    h(
      'div',
      { alignItems: 'center', gap: GAP },
      picture(avatar, card.name, AVATAR, true),
      h(
        'div',
        { flexDirection: 'column', width: INFO_WIDTH, gap: 18 },
        h(
          'div',
          { fontSize: nameSize, fontWeight: 700, lineHeight: 1.05, maxWidth: INFO_WIDTH },
          card.name
        ),
        card.team &&
          h(
            'div',
            { alignItems: 'center', gap: 16 },
            picture(teamLogo, card.team.name, 56),
            h('div', { fontSize: 34, fontWeight: 700 }, card.team.name),
            card.teamNote && h('div', { fontSize: 28, color: COLORS.faint }, `· ${card.teamNote}`)
          ),
        card.peakRank &&
          h(
            'div',
            { fontSize: 30, gap: 12, color: COLORS.muted },
            h('div', {}, 'Peak'),
            h('div', { color: COLORS.accent, fontWeight: 700 }, card.peakRank)
          )
      )
    ),
    statTiles(card.stats)
  )
}
