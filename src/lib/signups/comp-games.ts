/**
 * The signup eligibility rule: 100 competitive games in V26 on the main account.
 * Games on alts do not count.
 */

export const MIN_V26_COMP_GAMES = 100

export type GamesAccount = { riotId: string | null; puuid: string | null }

export type AccountGames = { games: number; account: string | null }

export function meetsGamesMinimum(games: number | null | undefined): boolean {
  return games != null && games >= MIN_V26_COMP_GAMES
}

/**
 * The account with the most games. Stops at the first that qualifies, since
 * every account checked spends a rate-limited lookup.
 */
export async function bestAccountGames(
  accounts: GamesAccount[],
  lookup: (account: GamesAccount) => Promise<number>
): Promise<AccountGames> {
  let best: AccountGames = { games: 0, account: accounts[0]?.riotId ?? null }
  for (const account of accounts) {
    const games = await lookup(account)
    if (games > best.games) best = { games, account: account.riotId }
    if (meetsGamesMinimum(best.games)) break
  }
  return best
}
