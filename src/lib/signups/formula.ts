import { TEAM_BALANCE_RANKS } from '$lib/team-balance'

/**
 * Player score formula.
 *
 *   score = 0.35·C + 0.65·P + bonus
 *   bonus = MIN(5, 10·MAX(0, rating − 1))
 *
 * Where:
 *   C      = current rank points
 *   P      = peak rank points since V26 Act 1
 *   rating = the player's imported performance rating (1.0 is average)
 *
 * Rank points are a straight linear scale — Iron 1 = 1 up to Radiant = 25 —
 * deliberately not the team calculator's scale, which spaces Immortal and
 * Radiant further apart.
 *
 * A player without both ranks is unverified and gets no score rather than a
 * partial one. A player without a rating simply gets no bonus.
 */

export const SCORE_WEIGHTS = {
  current: 0.35,
  peak: 0.65,
  bonusPerRating: 10,
  bonusCap: 5,
} as const

/** Rank name → points, by position on the league scale (Iron 1 = 1 … Radiant = 25). */
const RANK_POINTS = new Map<string, number>(TEAM_BALANCE_RANKS.map((r, i) => [r.name, i + 1]))

export function rankPoints(rankName: string | null | undefined): number | null {
  if (!rankName) return null
  return RANK_POINTS.get(rankName) ?? null
}

export function ratingBonus(rating: number | null | undefined): number {
  if (rating == null || !Number.isFinite(rating)) return 0
  return Math.min(SCORE_WEIGHTS.bonusCap, SCORE_WEIGHTS.bonusPerRating * Math.max(0, rating - 1))
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
  rating: number | null
}): ScoreBreakdown {
  const currentPoints = rankPoints(input.currentRank)
  const peakPoints = rankPoints(input.peakRank)
  const bonus = ratingBonus(input.rating)

  if (currentPoints == null || peakPoints == null) {
    return { currentPoints, peakPoints, weightedRankScore: null, bonus, total: null }
  }

  const weightedRankScore = SCORE_WEIGHTS.current * currentPoints + SCORE_WEIGHTS.peak * peakPoints

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
