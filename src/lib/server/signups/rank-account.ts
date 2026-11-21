import { computePlayerScore } from '$lib/signups/formula'
import type { CheckedAccount, SignupAltCheck } from '$lib/signups/alt-check'
import { meetsGamesMinimum } from '$lib/signups/comp-games'
import type { RankLookup } from '$lib/server/riot/henrik'

/**
 * Which of a player's accounts a signup's ranks come from.
 *
 * When the main has the games minimum since V26 Act 1, the best-scoring ranked
 * alt is the source of truth if its base score beats the main's, however few
 * games the alt has. When the main is short, only an alt that has the minimum
 * itself can stand in (the best-scoring one); if no account has the games, the
 * main is used and the signup reads as short. The main is also used when no
 * alt has a rank. An alt that beats the main is still called out for an admin
 * as `higherAlt`.
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
  const mainQualifies = meetsGamesMinimum(mainAccount.games)
  // A main short of games only hands over to an alt that has the games itself;
  // when no account has them, the signup stays on the main and reads as short.
  const candidate = mainQualifies
    ? altBeatsMain
      ? best
      : undefined
    : byScore.find((alt) => meetsGamesMinimum(alt.account.games))
  const standIn = candidate?.account.baseScore != null ? candidate : null

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
