import { TEAM_BALANCE_RANKS } from '$lib/team-balance'

/**
 * Map a Riot competitive tier onto the league's rank scale.
 *
 * The league scale mirrors Riot's tiers one-for-one (Iron 1 … Immortal 3,
 * Radiant), so this is a normalise-and-verify step rather than a conversion.
 * Anything unrecognised returns null so an admin fills it in instead of the
 * mapper guessing — a wrong rank silently feeds the rating formula.
 */

const LEAGUE_RANK_NAMES = new Set<string>(TEAM_BALANCE_RANKS.map((r) => r.name))

/** Riot writes tiers as "Diamond 2"; collapse spacing and fix casing. */
function normalizeTierName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function toLeagueRank(tierName: string | null | undefined): string | null {
  const raw = String(tierName ?? '').trim()
  if (!raw) return null
  // The API reports an unplaced account as "Unrated"; "Unranked" appears in
  // other sources. Neither is a rank, so leave the field for an admin.
  if (/^(unrated|unranked)$/i.test(raw)) return null

  const normalized = normalizeTierName(raw)
  if (LEAGUE_RANK_NAMES.has(normalized)) return normalized

  // Radiant has no sub-tier in game, but some sources still append one.
  if (/^radiant\b/i.test(normalized) && LEAGUE_RANK_NAMES.has('Radiant')) return 'Radiant'

  return null
}

/** True when the league scale recognises this name. */
export function isLeagueRank(name: string | null | undefined): boolean {
  return Boolean(name) && LEAGUE_RANK_NAMES.has(String(name).trim())
}
