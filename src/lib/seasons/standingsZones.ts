/**
 * Standings zones: which part of the table makes playoffs, goes to LCQ, is
 * eliminated, and so on — plus which stage the event is in.
 *
 * Every tournament cuts its table differently, so this is admin-entered rather
 * than derived. It lives in `seasons.metadata.standings`, alongside `profile`
 * and `map_pool`. A zone covers a rank range; a team can also be locked into a
 * zone once its fate is decided (clinched a spot, mathematically eliminated),
 * which holds no matter where it currently sits in the table.
 *
 * Client-safe and dependency-free so the leaderboard page, its inline admin
 * editor and the save endpoint share one sanitizer.
 */

export type StandingsStage = 'regular' | 'playoffs'

export const STANDINGS_ZONE_TONES = ['green', 'blue', 'purple', 'amber', 'red', 'gray'] as const
export type StandingsZoneTone = (typeof STANDINGS_ZONE_TONES)[number]

export type StandingsZone = {
  id: string
  label: string
  tone: StandingsZoneTone
  /** First rank in the zone, 1-based. */
  from: number
  /** Last rank in the zone; null runs to the bottom of the table. */
  to: number | null
}

export type StandingsConfig = {
  stage: StandingsStage
  zones: StandingsZone[]
  /** Team id → zone id, for teams whose zone is decided regardless of rank. */
  locked: Record<string, string>
}

export const EMPTY_STANDINGS_CONFIG: StandingsConfig = { stage: 'regular', zones: [], locked: {} }

/** Swatches, shared by the table stripe, the legend and the editor. */
export const ZONE_TONE_COLORS: Record<StandingsZoneTone, string> = {
  green: '#4ade80',
  blue: '#60a5fa',
  purple: '#c084fc',
  amber: '#fbbf24',
  red: '#f87171',
  gray: '#94a3b8',
}

function toRank(value: unknown): number | null {
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) && n >= 1 ? n : null
}

/** Coerce whatever is stored (or posted) into a well-formed config. */
export function sanitizeStandingsConfig(value: unknown): StandingsConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

  const zones: StandingsZone[] = []
  const seenIds = new Set<string>()
  for (const [index, entry] of (Array.isArray(raw.zones) ? raw.zones : []).entries()) {
    if (!entry || typeof entry !== 'object') continue
    const z = entry as Record<string, unknown>
    const label = typeof z.label === 'string' ? z.label.trim().slice(0, 40) : ''
    const from = toRank(z.from)
    if (!label || from == null) continue
    const to = z.to == null || z.to === '' ? null : toRank(z.to)
    let id = typeof z.id === 'string' && z.id.trim() ? z.id.trim().slice(0, 40) : `zone_${index}`
    while (seenIds.has(id)) id = `${id}_`
    seenIds.add(id)
    zones.push({
      id,
      label,
      tone: STANDINGS_ZONE_TONES.includes(z.tone as StandingsZoneTone)
        ? (z.tone as StandingsZoneTone)
        : 'gray',
      from,
      to: to != null && to < from ? from : to,
    })
  }
  zones.sort((a, b) => a.from - b.from)

  const locked: Record<string, string> = {}
  if (raw.locked && typeof raw.locked === 'object') {
    for (const [teamId, zoneId] of Object.entries(raw.locked as Record<string, unknown>)) {
      if (typeof zoneId === 'string' && seenIds.has(zoneId)) locked[teamId] = zoneId
    }
  }

  return { stage: raw.stage === 'playoffs' ? 'playoffs' : 'regular', zones, locked }
}

/** The zone a rank falls in, by range alone. */
export function zoneForRank(zones: StandingsZone[], rank: number | null): StandingsZone | null {
  if (rank == null) return null
  return zones.find((z) => rank >= z.from && (z.to == null || rank <= z.to)) ?? null
}

/**
 * The zone a team shows in: its locked zone when it has one, otherwise the
 * zone its current rank falls in.
 */
export function zoneForTeam(
  config: StandingsConfig,
  teamId: string,
  rank: number | null
): { zone: StandingsZone | null; locked: boolean } {
  const lockedId = config.locked[teamId]
  const lockedZone = lockedId ? config.zones.find((z) => z.id === lockedId) : undefined
  if (lockedZone) return { zone: lockedZone, locked: true }
  return { zone: zoneForRank(config.zones, rank), locked: false }
}

/** "1–6", "7+", "4" — the rank span a zone covers. */
export function zoneRangeLabel(zone: Pick<StandingsZone, 'from' | 'to'>): string {
  if (zone.to == null) return `${zone.from}+`
  return zone.to === zone.from ? String(zone.from) : `${zone.from}–${zone.to}`
}
