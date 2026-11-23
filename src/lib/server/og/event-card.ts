import { supabaseAdmin } from '$lib/supabase/admin'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { getSeasonLogoUrl } from '$lib/server/seasons/logo'
import { resolveSeasonMvp } from '$lib/seasons/mvp'
import { cardRoot, COLORS, h, headerRow, img, logoDataUri, picture, type Node } from './kit'

/**
 * The event page's preview card: the podium and MVP once the season is
 * decided, otherwise the season's logo, team count and whether it is running.
 */

type Team = { name: string; logo: string | null }

export type EventCardData = {
  name: string
  logo: string | null
  champion: Team | null
  runnerUp: Team | null
  third: Team | null
  mvp: { name: string; avatar: string | null } | null
  teamCount: number
  isActive: boolean
  startsOn: string | null
}

type TeamRel = { id: string; name: string; tag?: string | null; logo_path?: string | null }
type ProfileRel = {
  id: string
  display_name: string | null
  discord_id: string | null
  avatar_url: string | null
}

function one<T>(rel: T | T[] | null | undefined): T | null {
  return Array.isArray(rel) ? (rel[0] ?? null) : (rel ?? null)
}

function team(rel: TeamRel | null): Team | null {
  return rel ? { name: rel.name, logo: getTeamLogoUrl(rel) } : null
}

/** Everything the card shows, or null for an unknown season. */
export async function loadEventCard(seasonCode: string): Promise<EventCardData | null> {
  const { data: season } = await supabaseAdmin
    .from('seasons')
    .select(
      `id, name, starts_on, is_active, metadata, logo_path,
       winner:teams!seasons_winner_team_id_fkey (id, name, tag, logo_path),
       runner_up:teams!seasons_runner_up_team_id_fkey (id, name, tag, logo_path),
       third_place:teams!seasons_third_place_team_id_fkey (id, name, tag, logo_path),
       mvp:profiles!seasons_mvp_profile_id_fkey (id, display_name, discord_id, avatar_url)`
    )
    .eq('code', seasonCode)
    .maybeSingle()
  if (!season) return null

  const { count } = await supabaseAdmin
    .from('teams')
    .select('id', { count: 'exact', head: true })
    .eq('season_id', season.id)
    .eq('approval_status', 'approved')

  const mvpProfile = one(season.mvp as unknown as ProfileRel | ProfileRel[] | null)
  const mvp = resolveSeasonMvp(mvpProfile, season.metadata)

  return {
    name: String(season.name ?? 'Event').replace(/\s+/g, ' '),
    logo: getSeasonLogoUrl(season),
    champion: team(one(season.winner as TeamRel | TeamRel[] | null)),
    runnerUp: team(one(season.runner_up as TeamRel | TeamRel[] | null)),
    third: team(one(season.third_place as TeamRel | TeamRel[] | null)),
    mvp: mvp
      ? {
          name: mvp.name,
          avatar: mvpProfile?.discord_id ? (mvpProfile.avatar_url ?? null) : null,
        }
      : null,
    teamCount: count ?? 0,
    isActive: Boolean(season.is_active),
    startsOn: (season.starts_on as string | null) ?? null,
  }
}

// ── Rendering ───────────────────────────────────────────────────────────────

const SIDE_WIDTH = 300
const CHAMP_WIDTH = 400

function podiumSpot(
  spot: Team | null,
  logo: string | null,
  place: 'champion' | 'runnerUp' | 'third'
): Node {
  const champion = place === 'champion'
  const width = champion ? CHAMP_WIDTH : SIDE_WIDTH
  if (!spot) return h('div', { width })
  const size = champion ? 200 : 128
  const label = champion ? 'CHAMPION' : place === 'runnerUp' ? 'RUNNER-UP' : 'THIRD PLACE'
  const color = champion ? COLORS.gold : place === 'runnerUp' ? COLORS.silver : COLORS.bronze
  const nameSize = champion ? (spot.name.length > 16 ? 36 : 44) : spot.name.length > 14 ? 26 : 32
  return h(
    'div',
    {
      width,
      flexDirection: 'column',
      alignItems: 'center',
      gap: 12,
      // Sit the smaller logos level with the bottom of the champion's.
      paddingTop: champion ? 0 : 200 - size,
    },
    picture(logo, spot.name, size),
    h('div', { fontSize: champion ? 24 : 20, fontWeight: 700, letterSpacing: 4, color }, label),
    h(
      'div',
      {
        fontSize: nameSize,
        fontWeight: 700,
        lineHeight: 1.1,
        textAlign: 'center',
        justifyContent: 'center',
        maxWidth: width,
        color: champion ? COLORS.text : COLORS.muted,
      },
      spot.name
    )
  )
}

async function finishedCard(card: EventCardData): Promise<Node> {
  const [champ, runner, third, avatar] = await Promise.all([
    logoDataUri(card.champion?.logo, 400),
    logoDataUri(card.runnerUp?.logo, 256),
    logoDataUri(card.third?.logo, 256),
    logoDataUri(card.mvp?.avatar, 112, true),
  ])
  return cardRoot(
    {},
    headerRow(card.name),
    h(
      'div',
      { justifyContent: 'center', alignItems: 'flex-start', gap: 44 },
      podiumSpot(card.runnerUp, runner, 'runnerUp'),
      podiumSpot(card.champion, champ, 'champion'),
      podiumSpot(card.third, third, 'third')
    ),
    card.mvp
      ? h(
          'div',
          { justifyContent: 'center' },
          h(
            'div',
            {
              alignItems: 'center',
              gap: 16,
              padding: '10px 28px 10px 12px',
              borderRadius: 40,
              backgroundColor: COLORS.panel,
            },
            picture(avatar, card.mvp.name, 52, true),
            h(
              'div',
              { fontSize: 22, fontWeight: 700, letterSpacing: 4, color: COLORS.accent },
              'MVP'
            ),
            h('div', { fontSize: 30, fontWeight: 700 }, card.mvp.name)
          )
        )
      : h('div', { height: 72 })
  )
}

function statusLine(card: EventCardData): string {
  const parts = [card.teamCount > 0 ? `${card.teamCount} teams` : null]
  if (card.isActive) parts.push('In progress')
  else if (card.startsOn && card.startsOn > new Date().toISOString().slice(0, 10)) {
    const date = new Date(`${card.startsOn}T12:00:00Z`).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    })
    parts.push(`Starts ${date}`)
  } else if (!card.startsOn) parts.push('Coming soon')
  return parts.filter(Boolean).join(' · ')
}

async function upcomingCard(card: EventCardData): Promise<Node> {
  // No season logo: the name alone (the site logo would name another season).
  const logo = await logoDataUri(card.logo, 440)
  const status = statusLine(card)
  return cardRoot(
    {},
    headerRow('Event'),
    h(
      'div',
      { alignItems: 'center', justifyContent: 'center', gap: 56 },
      logo && img(logo, 260),
      h(
        'div',
        {
          flexDirection: 'column',
          gap: 18,
          maxWidth: logo ? 640 : 1000,
          alignItems: logo ? 'flex-start' : 'center',
        },
        h(
          'div',
          {
            fontSize: card.name.length > 16 ? 60 : logo ? 80 : 104,
            fontWeight: 700,
            lineHeight: 1.05,
            textAlign: logo ? 'left' : 'center',
          },
          card.name
        ),
        status &&
          h('div', { fontSize: 34, color: card.isActive ? COLORS.good : COLORS.muted }, status)
      )
    ),
    h('div', { height: 34 })
  )
}

export function buildEventCard(card: EventCardData): Promise<Node> {
  return card.champion ? finishedCard(card) : upcomingCard(card)
}

/** The parts of the card that change, for the page's `?v=`. */
export function eventCardVersionParts(card: EventCardData): unknown[] {
  return [card]
}
