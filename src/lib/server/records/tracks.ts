import { supabaseAdmin } from '$lib/supabase/admin'
import { isRecordSeasonCode } from '$lib/records/categories'

/** The permanent track: every Rivals season from Season 5 on. */
export const RIVALS_TRACK = 'rivals'

/** One set of records, stored under `stat_records.track`. */
export type RecordTrack = {
  key: string
  label: string
  seasonIds: string[]
  /** A side league tracked only for as long as it is the active season. */
  isSideLeague: boolean
}

type SeasonRow = { id: string; code: string; name: string; is_active: boolean | null }

/**
 * Rivals records always exist. While a non-Rivals season (a side league like
 * Shitter League) is active, it gets a track of its own — kept apart so its
 * records never enter the Rivals books. The Hall of Fame defaults to Rivals
 * whenever a Rivals season is active, and to the side league only when it is
 * the sole active season. Once that season ends, it goes back to Rivals.
 */
export function buildRecordTracks(seasons: SeasonRow[]): {
  rivals: RecordTrack
  sideLeague: RecordTrack | null
  display: RecordTrack
  /** Side leagues that have ended; their records stay frozen but viewable. */
  pastSideLeagues: RecordTrack[]
} {
  const rivals: RecordTrack = {
    key: RIVALS_TRACK,
    label: 'Rivals',
    seasonIds: seasons.filter((s) => isRecordSeasonCode(s.code)).map((s) => s.id),
    isSideLeague: false,
  }

  const isRivalsSeason = (s: SeasonRow) => /^rivals\d+$/i.test(s.code.trim())
  const activeSeasons = seasons.filter((s) => s.is_active)
  const active = activeSeasons.find((s) => !isRivalsSeason(s))
  const rivalsActive = activeSeasons.some(isRivalsSeason)
  const sideLeague: RecordTrack | null = active
    ? {
        key: active.code,
        label: active.name.replace(/\s+/g, ' ').trim(),
        seasonIds: [active.id],
        isSideLeague: true,
      }
    : null

  const pastSideLeagues: RecordTrack[] = seasons
    .filter((s) => !s.is_active && !isRivalsSeason(s))
    .map((s) => ({
      key: s.code,
      label: s.name.replace(/\s+/g, ' ').trim(),
      seasonIds: [s.id],
      isSideLeague: true,
    }))

  return {
    rivals,
    sideLeague,
    display: rivalsActive ? rivals : (sideLeague ?? rivals),
    pastSideLeagues,
  }
}

export async function loadRecordTracks() {
  const { data, error } = await supabaseAdmin.from('seasons').select('id, code, name, is_active')
  if (error) throw new Error(`Failed to load seasons: ${error.message}`)
  const tracks = buildRecordTracks((data ?? []) as SeasonRow[])
  if (tracks.pastSideLeagues.length === 0) return tracks

  // Only side leagues that were tracked while they ran have records to show.
  const { data: stored, error: storedError } = await supabaseAdmin
    .from('stat_records')
    .select('track')
    .in(
      'track',
      tracks.pastSideLeagues.map((t) => t.key)
    )
    .is('superseded_at', null)
  if (storedError) {
    console.error('Failed to load past side league records:', storedError)
    return { ...tracks, pastSideLeagues: [] }
  }
  const withRecords = new Set((stored ?? []).map((row) => row.track as string))
  return {
    ...tracks,
    pastSideLeagues: tracks.pastSideLeagues.filter((t) => withRecords.has(t.key)),
  }
}
