/**
 * Link previews. A page's server load returns `meta: PageMeta`; the root
 * layout turns it into Open Graph tags, which Discord (and anything else that
 * unfurls links) reads to build the card under a pasted URL. Pages without
 * `meta` get the site defaults, so every page unfurls as something.
 */

export const SITE_NAME = 'TC Rivals'

export const DEFAULT_DESCRIPTION =
  'Community Valorant league: matches, standings, player stats, pick’ems and the Hall of Fame.'

/** The league plays on Central time; previews show times there. */
export const LEAGUE_TIME_ZONE = 'America/Chicago'

export type PageMeta = {
  title: string
  description?: string | null
  /** Absolute URL or site path; the layout makes it absolute. */
  image?: string | null
  /** 'profile' for players, 'website' otherwise. */
  type?: 'website' | 'profile'
  /** The image is a 1200×630 card meant to show full width, not a small thumbnail. */
  largeImage?: boolean
}

/** Join the parts that exist with " · ", trimmed to what Discord shows (~300 chars). */
export function joinDescription(parts: Array<string | null | undefined | false>): string {
  const text = parts
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .join(' · ')
  return text.length > 300 ? `${text.slice(0, 297).trimEnd()}…` : text
}

/** "Sun, May 18, 2:00 PM CT" for a UTC timestamp. */
export function leagueTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const text = date.toLocaleString('en-US', {
    timeZone: LEAGUE_TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  return `${text} CT`
}

/** A number for a description: fixed digits, or null when missing. */
export function statText(value: unknown, digits = 0): string | null {
  const n = typeof value === 'number' ? value : Number(value)
  return value == null || value === '' || !Number.isFinite(n) ? null : n.toFixed(digits)
}

/** Previews for pages whose loaders return no `meta`, keyed by path. */
export const STATIC_PAGE_META: Record<string, PageMeta> = {
  '/leaderboard': {
    title: 'Leaderboard',
    description: 'Current standings and every approved team this season.',
  },
  '/stats': {
    title: 'Player Stats',
    description: 'ACS, K/D, KAST, ADR and more for every player, by season and phase.',
  },
  '/matches': { title: 'Matches', description: 'Upcoming, live and completed matches.' },
  '/events': {
    title: 'Events',
    description: 'Every season and event, with champions and brackets.',
  },
  '/hall-of-fame': {
    title: 'Hall of Fame',
    description: 'Champions, MVPs and the stat record book.',
  },
  '/pickems': { title: 'Pick’ems', description: 'Predict the results and climb the leaderboard.' },
  '/signup': { title: 'Player Signup', description: 'Sign up for the next season.' },
  '/team-balance': {
    title: 'Team Balance Calculator',
    description: 'Check how balanced a set of teams is.',
  },
  '/rulebook': { title: 'Rulebook', description: 'League rules and format.' },
  '/faq': { title: 'FAQ', description: 'Common questions about the league.' },
}
