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
 * Shitter League) is the active one, it gets a track of its own — kept apart
 * so its records never enter the Rivals books — and the Hall of Fame shows it
 * instead. Once that season ends, the page goes back to the Rivals records.
 */
export function buildRecordTracks(seasons: SeasonRow[]): {
  rivals: RecordTrack
  sideLeague: RecordTrack | null
  display: RecordTrack
} {
  const rivals: RecordTrack = {
    key: RIVALS_TRACK,
    label: 'Rivals',
    seasonIds: seasons.filter((s) => isRecordSeasonCode(s.code)).map((s) => s.id),
    isSideLeague: false,
  }

  const active = seasons.find((s) => s.is_active)
  const sideLeague: RecordTrack | null =
    active && !/^rivals\d+$/i.test(active.code.trim())
      ? {
          key: active.code,
          label: active.name.replace(/\s+/g, ' ').trim(),
          seasonIds: [active.id],
          isSideLeague: true,
        }
      : null

  return { rivals, sideLeague, display: sideLeague ?? rivals }
}

export async function loadRecordTracks() {
  const { data, error } = await supabaseAdmin.from('seasons').select('id, code, name, is_active')
  if (error) throw new Error(`Failed to load seasons: ${error.message}`)
  return buildRecordTracks((data ?? []) as SeasonRow[])
}
