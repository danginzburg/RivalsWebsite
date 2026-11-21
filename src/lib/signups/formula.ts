import { TEAM_BALANCE_RANKS } from '$lib/team-balance'

/**
 * Player score formula.
 *
 *   score = 0.35·C + 0.65·P + bonus
 *   bonus = climb · taper · clamp(2·perf, −3, 3)
 *
 * Where:
 *   C     = current rank points
 *   P     = peak rank points since V26 Act 1
 *   perf  = the player's league performance, in standard deviations above or
 *           below players who were the same rank at the time (see
 *           `$lib/server/signups/performance-model`). 0 is average for the rank.
 *   taper = 1 at Iron down to 0.5 at Radiant, on the weighted rank score: a
 *           bonus matters less at the top.
 *   climb = 1 − 0.25 per tier (3 divisions) climbed since the stats were
 *           played, down to 0: part of that performance is already in the new
 *           rank.
 *
 * Rank points are a straight linear scale — Iron 1 = 1 up to Radiant = 25 —
 * deliberately not the team calculator's scale, which spaces Immortal and
 * Radiant further apart.
 *
 * A player without both ranks is unverified and gets no score rather than a
 * partial one. A player without league stats gets no bonus, which is now the
 * same as being average for their rank.
 */

export const SCORE_WEIGHTS = {
  current: 0.35,
  peak: 0.65,
  /** Bonus points per standard deviation of rank-relative performance. */
  pointsPerSd: 2,
  bonusCap: 3,
  /** Share of the bonus left at Radiant; full size at Iron, linear between. */
  taperFloor: 0.5,
  /** Bonus lost per tier climbed since the stats were played. */
  climbShrinkPerTier: 0.25,
} as const

/** Rank name → points, by position on the league scale (Iron 1 = 1 … Radiant = 25). */
const RANK_POINTS = new Map<string, number>(TEAM_BALANCE_RANKS.map((r, i) => [r.name, i + 1]))

export function rankPoints(rankName: string | null | undefined): number | null {
  if (!rankName) return null
  return RANK_POINTS.get(rankName) ?? null
}

/** A player's league performance, the input to the bonus. */
export type Performance = {
  /** Standard deviations above (+) or below (−) players of the same rank at the time. */
  perf: number
  /** The rank the player held when the stats were played, on the league scale. */
  rankThen: string | null
}

/** 1 at Iron down to `taperFloor` at Radiant, on the weighted rank score. */
export function bonusTaper(weightedRankScore: number | null): number {
  if (weightedRankScore == null) return 1
  const t = Math.min(1, Math.max(0, (weightedRankScore - 1) / 24))
  return 1 - (1 - SCORE_WEIGHTS.taperFloor) * t
}

/** How much of the bonus survives the divisions climbed since the stats were played. */
export function climbFactor(currentRank: string | null, rankThen: string | null): number {
  const now = rankPoints(currentRank)
  const then = rankPoints(rankThen)
  if (now == null || then == null) return 1
  const tiers = Math.max(0, now - then) / 3
  return Math.max(0, 1 - SCORE_WEIGHTS.climbShrinkPerTier * tiers)
}

export function performanceBonus(
  performance: Performance | null | undefined,
  context: { currentRank: string | null; weightedRankScore: number | null }
): number {
  if (!performance || !Number.isFinite(performance.perf)) return 0
  const raw = SCORE_WEIGHTS.pointsPerSd * performance.perf
  const capped = Math.max(-SCORE_WEIGHTS.bonusCap, Math.min(SCORE_WEIGHTS.bonusCap, raw))
  const bonus =
    climbFactor(context.currentRank, performance.rankThen) *
    bonusTaper(context.weightedRankScore) *
    capped
  // Never hand back −0, which prints as "−0.00".
  return bonus === 0 ? 0 : bonus
}

export type ScoreBreakdown = {
  currentPoints: number | null
  peakPoints: number | null
  /** 0.35·C + 0.65·P, or null when either rank is missing. */
  weightedRankScore: number | null
  bonus: number
  /** Weighted rank score plus bonus, or null when unverified. */
  total: number | null
}

export function computePlayerScore(input: {
  currentRank: string | null
  peakRank: string | null
  performance: Performance | null
}): ScoreBreakdown {
  const currentPoints = rankPoints(input.currentRank)
  const peakPoints = rankPoints(input.peakRank)
  const weightedRankScore =
    currentPoints == null || peakPoints == null
      ? null
      : SCORE_WEIGHTS.current * currentPoints + SCORE_WEIGHTS.peak * peakPoints
  const bonus = performanceBonus(input.performance, {
    currentRank: input.currentRank,
    weightedRankScore,
  })

  if (weightedRankScore == null) {
    return { currentPoints, peakPoints, weightedRankScore: null, bonus, total: null }
  }

  return { currentPoints, peakPoints, weightedRankScore, bonus, total: weightedRankScore + bonus }
}

/** Round for storage and display — two decimals is plenty of precision here. */
export function roundRating(value: number): number {
  return Math.round(value * 100) / 100
}

/** Rank names offered in the signup form, excluding the Unranked sentinel. */
export const SIGNUP_RANK_OPTIONS = TEAM_BALANCE_RANKS.map((r) => ({
  value: r.name,
  label: r.name,
}))
