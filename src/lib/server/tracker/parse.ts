/**
 * Pure parsing for tracker.gg responses, kept apart from the transport so it
 * can be tested without network access.
 */

export type TrackerSeason = { id: string; shortName: string; name: string }

export type TrackerScoreComponent = {
  stat: string
  value: number | null
  percentile: number | null
}

export type TrackerActScore = {
  actId: string
  actShortName: string
  score: number
  components: TrackerScoreComponent[]
}

/** Weights behind trnPerformanceScore, per the published breakdown. */
const COMPONENT_WEIGHTS: Record<string, number> = {
  roundsWinPct: 0.15,
  kAST: 0.3,
  scorePerRound: 0.3,
  damageDeltaPerRound: 0.25,
}
const INTERCEPT = 9.2
const SCALE = 9.905

export function parseSeasons(profileJson: unknown): TrackerSeason[] {
  const seasons = (profileJson as { data?: { metadata?: { seasons?: unknown } } })?.data?.metadata
    ?.seasons
  if (!Array.isArray(seasons)) return []

  return seasons
    .map((s) => {
      const row = s as { id?: unknown; shortName?: unknown; name?: unknown }
      return {
        id: String(row.id ?? ''),
        shortName: String(row.shortName ?? ''),
        name: String(row.name ?? ''),
      }
    })
    .filter((s) => s.id.length > 0)
}

export function parseHandle(profileJson: unknown): string | null {
  const handle = (profileJson as { data?: { platformInfo?: { platformUserHandle?: unknown } } })
    ?.data?.platformInfo?.platformUserHandle
  return typeof handle === 'string' && handle.length > 0 ? handle : null
}

/**
 * Read the score for one act's competitive segment.
 *
 * The API reports the score directly as `trnPerformanceScore.value`; the
 * component percentiles are carried through only so an admin can see what
 * produced it. Returns null when the act has no competitive play.
 */
export function parseActScore(
  segmentJson: unknown,
  act: { id: string; shortName: string }
): TrackerActScore | null {
  const stats = (segmentJson as { data?: Array<{ stats?: Record<string, unknown> }> })?.data?.[0]
    ?.stats
  if (!stats) return null

  const perf = stats.trnPerformanceScore as
    | { value?: unknown; metadata?: { stats?: unknown } }
    | undefined
  const score = Number(perf?.value)
  if (!Number.isFinite(score)) return null

  const componentKeys = Array.isArray(perf?.metadata?.stats)
    ? (perf!.metadata!.stats as unknown[]).map(String)
    : []

  const components: TrackerScoreComponent[] = componentKeys.map((key) => {
    const stat = stats[key] as { value?: unknown; percentile?: unknown } | undefined
    return {
      stat: key,
      value: Number.isFinite(Number(stat?.value)) ? Number(stat?.value) : null,
      percentile: Number.isFinite(Number(stat?.percentile)) ? Number(stat?.percentile) : null,
    }
  })

  return { actId: act.id, actShortName: act.shortName, score, components }
}

/**
 * Recompute the score from component percentiles.
 *
 * Only used to sanity-check the reported value — a large gap means the
 * published weights have drifted and the reading should not be trusted.
 * Returns null when any percentile is missing.
 */
export function recomputeScore(components: TrackerScoreComponent[]): number | null {
  if (components.length === 0) return null

  let weighted = 0
  for (const c of components) {
    const weight = COMPONENT_WEIGHTS[c.stat]
    if (weight == null || c.percentile == null) return null
    weighted += weight * c.percentile
  }
  return Math.round(INTERCEPT + SCALE * weighted)
}

/** Highest score across the acts scanned. */
export function pickPeak(scores: TrackerActScore[]): TrackerActScore | null {
  if (scores.length === 0) return null
  return scores.reduce((best, s) => (s.score > best.score ? s : best))
}

/**
 * Find an act by Riot's canonical season UUID.
 *
 * tracker.gg and the Riot MMR API key acts by the same UUID but label them
 * differently — the act Riot calls "e10a3" is "E25: A3" on tracker — so the
 * id is the only safe way to line them up.
 */
export function findActById(
  seasons: TrackerSeason[],
  seasonId: string | null | undefined
): TrackerSeason | null {
  if (!seasonId) return null
  return seasons.find((s) => s.id === seasonId) ?? null
}
