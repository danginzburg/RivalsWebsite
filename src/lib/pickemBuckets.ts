import {
  buildPickemMatchupPairsFromRows,
  type PickemMatchupRow,
} from '$lib/pickemFinalRoundMatchups'

export const PICKEM_BUCKETS = ['3-0', '2-1', '1-2', '0-3'] as const

export type PickemBucket = (typeof PICKEM_BUCKETS)[number]

function parsePickemBucketToRecord(bucket: PickemBucket): { wins: number; losses: number } {
  const parts = bucket.split('-')
  const wins = Number(parts[0])
  const losses = Number(parts[1])
  return {
    wins: Number.isFinite(wins) ? wins : -1,
    losses: Number.isFinite(losses) ? losses : -1,
  }
}

/**
 * Final Swiss buckets reachable from a baseline record: each team plays
 * (totalRounds - baselineCompletedRounds) more series, so a bucket (W,L) is possible iff
 * W ≥ wins, L ≥ losses, and W + L === totalRounds.
 */
export function getAllowedPickemBucketsForRecord(
  wins: number,
  losses: number,
  baselineCompletedRounds: number,
  totalRounds: number
): PickemBucket[] {
  if (wins + losses !== baselineCompletedRounds) return []
  if (!Number.isInteger(totalRounds) || totalRounds < 0) return []

  return PICKEM_BUCKETS.filter((bucket) => {
    const { wins: bw, losses: bl } = parsePickemBucketToRecord(bucket)
    if (bw + bl !== totalRounds) return false
    return bw >= wins && bl >= losses
  })
}

/** Final standing bucket for an exact W–L record (must sum to totalRounds). */
export function recordToPickemBucket(
  wins: number,
  losses: number,
  totalRounds: number
): PickemBucket | null {
  if (wins + losses !== totalRounds) return null
  const key = `${wins}-${losses}`
  return (PICKEM_BUCKETS as readonly string[]).includes(key) ? (key as PickemBucket) : null
}

export type MatchupJointOutcomes = {
  /** First tag in the pairing wins the head-to-head. */
  ifFirstWins: [PickemBucket, PickemBucket] | null
  /** Second tag in the pairing wins the head-to-head. */
  ifSecondWins: [PickemBucket, PickemBucket] | null
}

/**
 * Two joint bucket outcomes when the two teams play each other once more (one series left).
 * `first`/`second` correspond to tag order in PICKEM_FINAL_ROUND_MATCHUP_TAGS.
 * Returns both null if baseline/total rounds do not imply a single decider or records are invalid.
 */
export function getMatchupJointOutcomes(
  wFirst: number,
  lFirst: number,
  wSecond: number,
  lSecond: number,
  baselineCompletedRounds: number,
  totalRounds: number
): MatchupJointOutcomes {
  if (
    wFirst + lFirst !== baselineCompletedRounds ||
    wSecond + lSecond !== baselineCompletedRounds
  ) {
    return { ifFirstWins: null, ifSecondWins: null }
  }
  const remaining = totalRounds - baselineCompletedRounds
  if (remaining !== 1) {
    return { ifFirstWins: null, ifSecondWins: null }
  }

  const a1 = recordToPickemBucket(wFirst + 1, lFirst, totalRounds)
  const b1 = recordToPickemBucket(wSecond, lSecond + 1, totalRounds)
  const ifFirstWins = a1 && b1 ? ([a1, b1] as [PickemBucket, PickemBucket]) : null

  const a2 = recordToPickemBucket(wFirst, lFirst + 1, totalRounds)
  const b2 = recordToPickemBucket(wSecond + 1, lSecond, totalRounds)
  const ifSecondWins = a2 && b2 ? ([a2, b2] as [PickemBucket, PickemBucket]) : null

  return { ifFirstWins, ifSecondWins }
}

/** True if (bucketFirst, bucketSecond) equals one of the two joint outcomes (same orientation). */
export function jointBucketsMatchAMatchup(
  bucketFirst: PickemBucket,
  bucketSecond: PickemBucket,
  outcomes: MatchupJointOutcomes
): boolean {
  const { ifFirstWins, ifSecondWins } = outcomes
  if (ifFirstWins && ifFirstWins[0] === bucketFirst && ifFirstWins[1] === bucketSecond) return true
  if (ifSecondWins && ifSecondWins[0] === bucketFirst && ifSecondWins[1] === bucketSecond)
    return true
  return false
}

/** Opponent bucket after this side picks `pickedBucket`, or null if no matching scenario. */
export function partnerBucketAfterPick(
  isFirstInPair: boolean,
  pickedBucket: PickemBucket,
  outcomes: MatchupJointOutcomes
): PickemBucket | null {
  if (outcomes.ifFirstWins) {
    const [bf, bs] = outcomes.ifFirstWins
    if (isFirstInPair && pickedBucket === bf) return bs
    if (!isFirstInPair && pickedBucket === bs) return bf
  }
  if (outcomes.ifSecondWins) {
    const [bf, bs] = outcomes.ifSecondWins
    if (isFirstInPair && pickedBucket === bf) return bs
    if (!isFirstInPair && pickedBucket === bs) return bf
  }
  return null
}

/**
 * Buckets this side can pick: intersected with record reachability.
 * If opponent bucket is known, only scenarios consistent with it; otherwise union of scenario buckets for this side.
 */
export function matchupAllowedBucketsForSide(
  isFirstInPair: boolean,
  opponentBucket: PickemBucket | undefined,
  outcomes: MatchupJointOutcomes,
  recordAllowed: PickemBucket[]
): PickemBucket[] {
  const fromBothScenarios = (): PickemBucket[] => {
    const acc: PickemBucket[] = []
    if (outcomes.ifFirstWins)
      acc.push(isFirstInPair ? outcomes.ifFirstWins[0] : outcomes.ifFirstWins[1])
    if (outcomes.ifSecondWins)
      acc.push(isFirstInPair ? outcomes.ifSecondWins[0] : outcomes.ifSecondWins[1])
    return [...new Set(acc)].filter((b) => recordAllowed.includes(b))
  }

  if (!outcomes.ifFirstWins && !outcomes.ifSecondWins) return recordAllowed

  if (opponentBucket === undefined) {
    const u = fromBothScenarios()
    return u.length > 0 ? u : recordAllowed
  }

  const ok: PickemBucket[] = []
  if (outcomes.ifFirstWins) {
    const [bf, bs] = outcomes.ifFirstWins
    if (isFirstInPair && bs === opponentBucket) ok.push(bf)
    if (!isFirstInPair && bf === opponentBucket) ok.push(bs)
  }
  if (outcomes.ifSecondWins) {
    const [bf, bs] = outcomes.ifSecondWins
    if (isFirstInPair && bs === opponentBucket) ok.push(bf)
    if (!isFirstInPair && bf === opponentBucket) ok.push(bs)
  }
  const filtered = [...new Set(ok)].filter((b) => recordAllowed.includes(b))
  return filtered.length > 0 ? filtered : recordAllowed
}

type PickemCoerceRow = PickemMatchupRow & { wins: number; losses: number }

/** If a saved assignment violates matchup joint outcomes, reset that pair to the first scenario (first tag wins). */
export function coerceMatchupBucketAssignments(
  assigned: Map<string, string>,
  rows: PickemCoerceRow[],
  baselineCompletedRounds: number,
  totalRounds: number
): Map<string, string> {
  const rowById = new Map(
    rows.map((r) => [r.team?.id ?? '', r] as const).filter(([id]) => Boolean(id))
  )
  const next = new Map(assigned)
  for (const [idF, idS] of buildPickemMatchupPairsFromRows(rows)) {
    const rowF = rowById.get(idF)
    const rowS = rowById.get(idS)
    if (!rowF || !rowS) continue
    const outcomes = getMatchupJointOutcomes(
      rowF.wins,
      rowF.losses,
      rowS.wins,
      rowS.losses,
      baselineCompletedRounds,
      totalRounds
    )
    if (!outcomes.ifFirstWins && !outcomes.ifSecondWins) continue
    const bf = next.get(idF) as PickemBucket | undefined
    const bs = next.get(idS) as PickemBucket | undefined
    if (bf && bs && jointBucketsMatchAMatchup(bf, bs, outcomes)) continue
    if (outcomes.ifFirstWins) {
      next.set(idF, outcomes.ifFirstWins[0])
      next.set(idS, outcomes.ifFirstWins[1])
    }
  }
  return next
}
