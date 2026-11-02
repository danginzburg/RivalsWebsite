import { supabaseAdmin } from '$lib/supabase/admin'
import { fetchV26Games, type LookupOptions } from '$lib/server/riot/henrik'
import { linkedRiotAccountsFor } from '$lib/server/players/riot-accounts'
import { bestAccountGames, type AccountGames, type GamesAccount } from '$lib/signups/comp-games'

/**
 * The account to count each player's games on: only the main is held to the
 * minimum. That is the primary linked account, or the Riot ID on the signup
 * when none is linked yet.
 */
export async function gamesAccountsFor(
  signups: Array<{ profile_id: string; display_name: string | null; riot_tag: string | null }>
): Promise<Map<string, GamesAccount[]>> {
  const linked = await linkedRiotAccountsFor(signups.map((s) => s.profile_id))
  const accounts = new Map<string, GamesAccount[]>()
  for (const signup of signups) {
    const name = signup.display_name?.trim()
    const tag = signup.riot_tag?.trim()
    const links = linked.get(signup.profile_id) ?? []
    accounts.set(
      signup.profile_id,
      links.length > 0
        ? links.slice(0, 1).map(({ riotId, puuid }) => ({ riotId, puuid }))
        : name && tag
          ? [{ riotId: `${name}#${tag}`, puuid: null }]
          : []
    )
  }
  return accounts
}

/** Count a player's V26 games and store the best account's total on the signup. */
export async function checkSignupGames(
  signupId: string,
  accounts: GamesAccount[],
  opts: LookupOptions = {}
): Promise<AccountGames> {
  const best = await bestAccountGames(accounts, (account) => fetchV26Games(account, opts))

  const { error } = await supabaseAdmin
    .from('player_signups')
    .update({
      v26_comp_games: best.games,
      v26_comp_games_account: best.account,
      v26_comp_games_checked_at: new Date().toISOString(),
    })
    .eq('id', signupId)
  if (error) throw new Error(`Failed to store V26 games: ${error.message}`)
  return best
}
