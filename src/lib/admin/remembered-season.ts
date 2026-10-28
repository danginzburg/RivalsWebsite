/**
 * The season an admin last picked, shared by every admin season picker (the
 * dashboard's Teams/Matches filter, Pick'em, match import, stats import) so a
 * refresh or a trip to another page lands back on the season being worked on
 * instead of resetting to the active one.
 *
 * Read it in onMount, never in a state initializer: localStorage does not exist
 * during the server render, and switching after hydration avoids a mismatch.
 */
const REMEMBERED_SEASON_STORAGE_KEY = 'admin:seasonId'

/** Saves a season the admin chose. Call it from the picker's change handler only. */
export function rememberAdminSeason(seasonId: string) {
  try {
    localStorage.setItem(REMEMBERED_SEASON_STORAGE_KEY, seasonId)
  } catch {
    // Ignore storage failures (private mode, quota) — the picker still switches.
  }
}

/**
 * The remembered season, or null when nothing is stored or the stored value
 * is not one of `validValues` (a deleted season, or a value like "All seasons"
 * that this picker does not offer).
 */
export function readRememberedAdminSeason(validValues: readonly string[]): string | null {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(REMEMBERED_SEASON_STORAGE_KEY)
  } catch {
    return null
  }
  return stored !== null && validValues.includes(stored) ? stored : null
}
