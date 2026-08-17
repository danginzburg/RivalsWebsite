/**
 * Competition sections — the vocabulary shared by matches and stat batches.
 *
 * Two things need to agree on what "playoffs" means:
 *   - `matches.stage`, which decides *which matches* feed a generated batch
 *   - `stat_import_batches.section`, which decides *where the batch appears* in
 *     the stats picker
 *
 * Keeping one list means a batch generated from play-in matches always lands in
 * the Play-ins group, and a CSV batch tagged by hand lands in the same place.
 *
 * The keys are stored in the database, so renaming one is a migration. Labels
 * are display-only and safe to change.
 */

export const SECTION_KEYS = [
  'kickoff',
  'regular',
  'playins',
  'playoffs',
  'weeks',
  'alltime',
  'other',
] as const

export type SectionKey = (typeof SECTION_KEYS)[number]

export type SectionDef = {
  key: SectionKey
  label: string
  /** Whether a match can be filed under it. Weeks/all-time describe batches only. */
  isMatchStage: boolean
}

/** Declaration order is display order, in the picker and in the admin table. */
export const SECTIONS: SectionDef[] = [
  { key: 'kickoff', label: 'Kickoff', isMatchStage: true },
  { key: 'regular', label: 'Regular Season', isMatchStage: true },
  { key: 'playins', label: 'Play-ins', isMatchStage: true },
  { key: 'playoffs', label: 'Playoffs', isMatchStage: true },
  { key: 'weeks', label: 'Weeks', isMatchStage: false },
  { key: 'alltime', label: 'All Time', isMatchStage: false },
  { key: 'other', label: 'Other', isMatchStage: false },
]

/** Sections a match can be filed under — what the generator offers as filters. */
export const MATCH_STAGES: SectionDef[] = SECTIONS.filter((s) => s.isMatchStage)

const BY_KEY = new Map<string, SectionDef>(SECTIONS.map((s) => [s.key, s]))

export function isSectionKey(value: unknown): value is SectionKey {
  return typeof value === 'string' && BY_KEY.has(value)
}

/** Free-form input (form field, DB column, older data) to a key, or null. */
export function normalizeSectionKey(value: unknown): SectionKey | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  return isSectionKey(v) ? v : null
}

export function sectionLabel(key: unknown): string {
  const k = normalizeSectionKey(key)
  return k ? (BY_KEY.get(k)?.label ?? 'Other') : 'Other'
}

/** Position in `SECTIONS`; unknown keys sort after everything known. */
export function sectionOrder(key: unknown): number {
  const k = normalizeSectionKey(key)
  if (!k) return SECTIONS.length
  const idx = SECTIONS.findIndex((s) => s.key === k)
  return idx === -1 ? SECTIONS.length : idx
}

/**
 * Guess a section from a human label — a batch's `display_name` or a match's
 * `designation`.
 *
 * This is what makes the feature work without re-tagging four seasons of
 * history by hand: names like "Season 4 Playoffs [NA]" and "Grand Finals"
 * already say which section they belong to. An explicit column value always
 * wins over this guess; it only fills the gap.
 *
 * Order matters. "Season 4 [NA] Play-ins + Playoffs" is a combined postseason
 * batch and matches both patterns, so playoffs is tested first and wins — the
 * later stage is the honest home for a batch that spans both.
 *
 * Returns null when nothing in the name points anywhere, so callers can decide
 * between "other" and leaving it unset.
 */
export function inferSectionFromLabel(raw: unknown): SectionKey | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim().toLowerCase()
  if (!text) return null

  if (/all[\s-]?time/.test(text)) return 'alltime'
  if (
    /play[\s-]?off|post[\s-]?season|grand[\s-]?final|semi[\s-]?final|quarter[\s-]?final|bracket|\bro(?:und)?\s?of\s?\d+\b|\bgf\b|\bufinal\b/.test(
      text
    )
  )
    return 'playoffs'
  if (/play[\s-]?in|qualifier|\bqual\b/.test(text)) return 'playins'
  if (/kick[\s-]?off/.test(text)) return 'kickoff'
  if (/\bweeks?\b|\bwk\s?\d/.test(text)) return 'weeks'
  // A plain "Season 4 (NA)" with no stage word is this league's regular season.
  if (/season\s*\d|\bregular\b|\bgroup stage\b|\bround robin\b/.test(text)) return 'regular'

  return null
}

/**
 * Same guess, narrowed to something a match can be filed under.
 *
 * A match designation of "Week 3" describes the regular season — `weeks` is a
 * batch-only bucket for cumulative snapshots, and a match never belongs there.
 */
export function inferMatchStageFromLabel(raw: unknown): SectionKey | null {
  const guess = inferSectionFromLabel(raw)
  if (guess === 'weeks') return 'regular'
  if (guess === null) return null
  return BY_KEY.get(guess)?.isMatchStage ? guess : null
}

/**
 * The section a batch should show under, given everything known about it.
 *
 * `section` is the stored answer. Weekly imports are a bucket of their own even
 * without one — that is what the stats page's "Hide weeks" toggle has always
 * keyed off. Otherwise fall back to reading the name.
 */
export function resolveBatchSection(batch: {
  section?: string | null
  import_kind?: string | null
  week_label?: string | null
  display_name?: string | null
}): SectionKey {
  const explicit = normalizeSectionKey(batch.section)
  if (explicit) return explicit
  if (batch.import_kind === 'weekly' || batch.week_label) return 'weeks'
  return inferSectionFromLabel(batch.display_name) ?? 'other'
}
