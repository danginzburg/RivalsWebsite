/**
 * Admin edits laid over the generated stat records (see the
 * stat_record_overrides migrations for why they live in their own table).
 *
 * An edit is either category-wide (entry_key '') — title, description, hiding
 * the whole category — or aimed at one performance in the top 5 (entry_key
 * from `recordEntryKey`) — correcting its value, holder or team, or hiding it
 * so the next performance moves up.
 */

export type StatRecordOverride = {
  track: string
  category: string
  entry_key: string
  is_hidden: boolean
  title: string | null
  description: string | null
  value_text: string | null
  unit: string | null
  profile_id: string | null
  player_name: string | null
  team_id: string | null
  /** Snapshot naming the performance, for a hidden one the admin wants to bring back. */
  label: string | null
}

/** The category-wide edit's key. */
export const CATEGORY_ENTRY_KEY = ''

/**
 * Names one performance: the match map, plus the stat row for a player
 * record (a team record is the map itself). A re-import recreates both, so an
 * old edit is left behind rather than landing on a different performance.
 */
export function recordEntryKey(matchMapId: string | null, statId: number | null): string {
  return `${matchMapId ?? ''}:${statId ?? ''}`
}
