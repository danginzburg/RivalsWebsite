import { computePlayerScore } from '$lib/signups/formula'
import type { CheckedAccount, SignupAltCheck } from '$lib/signups/alt-check'
import { meetsGamesMinimum } from '$lib/signups/comp-games'
import type { RankLookup } from '$lib/server/riot/henrik'

/**
 * Which of a player's accounts a signup's ranks come from.
 *
 * The best-scoring ranked alt is the source of truth when either the main is
 * short of games since V26 Act 1, or that alt's base score beats the main's.
 * Only the main is held to the games minimum; an alt counts as long as it was
 * submitted (not rejected) and has a rank. Otherwise the main is used, also
 * when no alt has a rank. An alt that beats the main is still called out for
 * an admin as `higherAlt`.
 */

export type RankTarget = { riotId: string | null; puuid: string | null }

function describe(target: RankTarget, { account, rank }: RankLookup): CheckedAccount {
  const currentRank = rank?.currentRank ?? null
  const peakRank = rank?.peakRank ?? null
  const fetched = account.name && account.tag ? `${account.name}#${account.tag}` : null
  return {
    riotId: target.riotId ?? fetched ?? 'Unknown',
    currentRank,
    peakRank,
    games: rank?.gamesInWindow ?? 0,
    baseScore: computePlayerScore({ currentRank, peakRank, rating: null }).weightedRankScore,
  }
}

const scoreOf = (account: CheckedAccount) => account.baseScore ?? -1

function isRateLimit(err: unknown): boolean {
  return (err as { status?: unknown } | null)?.status === 429
}

/**
 * Look up the main account and its alts. An alt that cannot be looked up is
 * left out, so it never blocks the main; a rate limit still reaches the caller
 * so the signup can be retried whole.
 */
export async function pickSignupAccount(
  main: RankTarget,
  alts: RankTarget[],
  lookup: (target: RankTarget) => Promise<RankLookup>
): Promise<{ lookup: RankLookup; check: SignupAltCheck | null }> {
  const mainLookup = await lookup(main)
  if (alts.length === 0) return { lookup: mainLookup, check: null }

  const checked: Array<{ account: CheckedAccount; lookup: RankLookup }> = []
  for (const alt of alts) {
    try {
      const altLookup = await lookup(alt)
      checked.push({ account: describe(alt, altLookup), lookup: altLookup })
    } catch (err) {
      if (isRateLimit(err)) throw err
      console.warn('pickSignupAccount: skipped alt', alt.riotId, err)
    }
  }

  const mainAccount = describe(main, mainLookup)
  const byScore = [...checked].sort((a, b) => scoreOf(b.account) - scoreOf(a.account))

  const best = byScore[0]
  const altBeatsMain = best != null && scoreOf(best.account) > scoreOf(mainAccount)
  const standIn =
    best?.account.baseScore != null && (altBeatsMain || !meetsGamesMinimum(mainAccount.games))
      ? best
      : null

  const higherAlt = altBeatsMain ? best.account.riotId : null

  return {
    lookup: standIn?.lookup ?? mainLookup,
    check: {
      main: mainAccount,
      alts: checked.map((alt) => alt.account),
      usedRiotId: (standIn?.account ?? mainAccount).riotId,
      higherAlt,
    },
  }
}
