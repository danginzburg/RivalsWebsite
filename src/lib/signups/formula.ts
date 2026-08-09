import { getRankValue, TEAM_BALANCE_RANKS } from '$lib/team-balance'

/**
 * Player rating formula.
 *
 *   base       = 0.575·C + 0.425·P + 0.15·√Tc + 0.075·ln(Tp)
 *   multiplier = 1 + 0.1·(C / P)
 *   rating     = base × multiplier
 *
 * Where:
 *   C  = current rank value   (from TEAM_BALANCE_RANKS)
 *   P  = peak rank value      (from TEAM_BALANCE_RANKS)
 *   Tc = tracker current score
 *   Tp = tracker peak score
 *
 * Every term degrades safely: a missing tracker score contributes 0 rather
 * than NaN, and a zero peak rank skips the ratio multiplier instead of
 * dividing by zero.
 */

export type FormulaInputs = {
  /** C — current rank value. */
  currentRankValue: number
  /** P — peak rank value. */
  peakRankValue: number
  /** Tc — tracker current score. */
  trackerCurrentScore: number | null
  /** Tp — tracker peak score. */
  trackerPeakScore: number | null
}

export type FormulaBreakdown = {
  currentTerm: number
  peakTerm: number
  trackerCurrentTerm: number
  trackerPeakTerm: number
  base: number
  multiplier: number
  rating: number
}

export const FORMULA_WEIGHTS = {
  current: 0.575,
  peak: 0.425,
  trackerCurrentSqrt: 0.15,
  trackerPeakLog: 0.075,
  ratioBonus: 0.1,
} as const

function safeNumber(value: number | null | undefined): number {
  if (value == null) return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** √Tc, guarding against negative input. */
function sqrtTerm(value: number): number {
  return value > 0 ? Math.sqrt(value) : 0
}

/**
 * ln(Tp), guarding against ln(0) = -Infinity and negatives.
 * Scores at or below 1 contribute nothing.
 */
function logTerm(value: number): number {
  return value > 1 ? Math.log(value) : 0
}

export function computeRating(inputs: FormulaInputs): FormulaBreakdown {
  const c = safeNumber(inputs.currentRankValue)
  const p = safeNumber(inputs.peakRankValue)
  const tc = safeNumber(inputs.trackerCurrentScore)
  const tp = safeNumber(inputs.trackerPeakScore)

  const currentTerm = FORMULA_WEIGHTS.current * c
  const peakTerm = FORMULA_WEIGHTS.peak * p
  const trackerCurrentTerm = FORMULA_WEIGHTS.trackerCurrentSqrt * sqrtTerm(tc)
  const trackerPeakTerm = FORMULA_WEIGHTS.trackerPeakLog * logTerm(tp)

  const base = currentTerm + peakTerm + trackerCurrentTerm + trackerPeakTerm

  // A peak of zero means we have no ratio to reason about — skip the bonus.
  const multiplier = p > 0 ? 1 + FORMULA_WEIGHTS.ratioBonus * (c / p) : 1

  return {
    currentTerm,
    peakTerm,
    trackerCurrentTerm,
    trackerPeakTerm,
    base,
    multiplier,
    rating: base * multiplier,
  }
}

/** Convenience wrapper that resolves rank names before computing. */
export function computeRatingFromRankNames(input: {
  currentRank: string | null
  peakRank: string | null
  trackerCurrentScore: number | null
  trackerPeakScore: number | null
}): FormulaBreakdown {
  return computeRating({
    currentRankValue: input.currentRank ? getRankValue(input.currentRank) : 0,
    peakRankValue: input.peakRank ? getRankValue(input.peakRank) : 0,
    trackerCurrentScore: input.trackerCurrentScore,
    trackerPeakScore: input.trackerPeakScore,
  })
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
