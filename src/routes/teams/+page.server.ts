import { redirect } from '@sveltejs/kit'

/**
 * The team directory was merged into the leaderboard, which shows standings
 * and every approved team in one place. Individual team pages at
 * /teams/[id] are unaffected.
 */
export const load = async () => {
  throw redirect(308, '/leaderboard')
}
