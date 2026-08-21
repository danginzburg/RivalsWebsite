/**
 * Per-event presentation profile.
 *
 * An "event" is a row in the `seasons` table. Rivals events and external
 * tournaments share the same infrastructure (matches, stats, standings), but an
 * external event may want to hide sections that don't apply and link out to a
 * rulebook / signup / FAQ hosted elsewhere. That presentation lives in
 * `seasons.metadata.profile`, alongside `map_pool` and `stat_batches`.
 *
 * This module is deliberately dependency-free and client-safe so the event page
 * (server + Svelte) and the admin editor can all share one resolver. Rivals
 * events carry no `profile` key, so `resolveSeasonProfile` defaults every
 * section on and returns no links — leaving them identical to before this
 * feature existed.
 */

export type SeasonKind = 'rivals' | 'external'

export type SeasonSectionKey =
  | 'standings'
  | 'matches'
  | 'teams'
  | 'bracket'
  | 'mapPool'
  | 'comments'

export type SeasonExternalLink = { label: string; url: string }

export type SeasonProfile = {
  sections: Record<SeasonSectionKey, boolean>
  links: SeasonExternalLink[]
}

/** Canonical order — drives both the admin checkboxes and any UI iteration. */
export const SEASON_SECTION_KEYS: readonly SeasonSectionKey[] = [
  'standings',
  'matches',
  'teams',
  'bracket',
  'mapPool',
  'comments',
] as const

/** Human labels for the section toggles in the admin editor. */
export const SEASON_SECTION_LABELS: Record<SeasonSectionKey, string> = {
  standings: 'Standings',
  matches: 'Matches',
  teams: 'Teams',
  bracket: 'Bracket',
  mapPool: 'Map Pool',
  comments: 'Comments',
}

/** Every section enabled — the default, matching pre-profile behaviour. */
export function allSectionsOn(): Record<SeasonSectionKey, boolean> {
  return {
    standings: true,
    matches: true,
    teams: true,
    bracket: true,
    mapPool: true,
    comments: true,
  }
}

function normalizeLinks(value: unknown): SeasonExternalLink[] {
  if (!Array.isArray(value)) return []
  const links: SeasonExternalLink[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const url =
      typeof (entry as { url?: unknown }).url === 'string'
        ? (entry as { url: string }).url.trim()
        : ''
    if (!url) continue
    const rawLabel =
      typeof (entry as { label?: unknown }).label === 'string'
        ? (entry as { label: string }).label.trim()
        : ''
    links.push({ label: rawLabel || url, url })
  }
  return links
}

/**
 * Read the profile from a season's metadata, filling defaults. Missing or
 * malformed input yields "all sections on, no links".
 */
export function resolveSeasonProfile(
  metadata: Record<string, unknown> | null | undefined
): SeasonProfile {
  const sections = allSectionsOn()
  let links: SeasonExternalLink[] = []

  const raw =
    metadata && typeof metadata === 'object'
      ? (metadata as { profile?: unknown }).profile
      : undefined

  if (raw && typeof raw === 'object') {
    const rawSections = (raw as { sections?: unknown }).sections
    if (rawSections && typeof rawSections === 'object') {
      for (const key of SEASON_SECTION_KEYS) {
        const value = (rawSections as Record<string, unknown>)[key]
        // Only an explicit `false` turns a section off; anything else stays on.
        if (value === false) sections[key] = false
      }
    }
    links = normalizeLinks((raw as { links?: unknown }).links)
  }

  return { sections, links }
}

/**
 * Normalize an arbitrary payload (e.g. from the admin PATCH body) into a clean
 * profile safe to persist. Used server-side before merging into metadata.
 */
export function sanitizeSeasonProfile(input: unknown): SeasonProfile {
  const sections = allSectionsOn()
  let links: SeasonExternalLink[] = []

  if (input && typeof input === 'object') {
    const rawSections = (input as { sections?: unknown }).sections
    if (rawSections && typeof rawSections === 'object') {
      for (const key of SEASON_SECTION_KEYS) {
        sections[key] = (rawSections as Record<string, unknown>)[key] !== false
      }
    }
    links = normalizeLinks((input as { links?: unknown }).links)
  }

  return { sections, links }
}
