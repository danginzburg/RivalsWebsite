import { computePlayerScore } from '$lib/signups/formula'
import type { CheckedAccount, SignupAltCheck } from '$lib/signups/alt-check'
import { meetsGamesMinimum } from '$lib/signups/comp-games'
import type { RankLookup } from '$lib/server/riot/henrik'

/**
 * Which of a player's accounts a signup's ranks come from.
 *
 * The main account is used once it has enough games since V26 Act 1. Below
 * that, the alt with the best base score stands in, however few games it has;
 * only the main is held to the minimum. With no ranked alt, the main is still
 * used. Separately, any alt whose base score beats the main is called out for
 * an admin, whichever account was used.
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
  const standIn =
    !meetsGamesMinimum(mainAccount.games) && best?.account.baseScore != null ? best : null

  const higherAlt =
    best && scoreOf(best.account) > scoreOf(mainAccount) ? best.account.riotId : null

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
