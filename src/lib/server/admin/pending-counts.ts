import { supabaseAdmin } from '$lib/supabase/admin'

export type AdminPendingCounts = {
  /** Comment reports + data flags + bug reports: the Moderation tab's queues. */
  moderation: number
  /** Player signups + alternate Riot accounts: the Signups tab's queues. */
  signups: number
}

/*
 * Pending-approval counts for the admin tab badges, one entry per tab that has
 * a review queue. Counted server-side rather than from the tab's loaded rows:
 * the lists are lazy-loaded and filtered by status, so a client-side count
 * reads zero before the tab is opened or once the filter leaves "pending".
 * A failed count falls back to zero rather than blocking the dashboard.
 */
async function countPending(table: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (error) {
    console.error(`Error counting pending ${table}:`, error)
    return 0
  }
  return count ?? 0
}

/**
 * Pending alternate accounts that need reviewing on their own. A player with a
 * pending signup already counts once, and their alts are reviewed inside it.
 * Primary accounts are never reviewed, so they are not in this queue.
 */
async function countStandaloneAlts(): Promise<number> {
  const [alts, signups] = await Promise.all([
    supabaseAdmin
      .from('riot_accounts')
      .select('profile_id')
      .eq('status', 'pending')
      .eq('is_primary', false),
    supabaseAdmin.from('player_signups').select('profile_id').eq('status', 'pending'),
  ])
  const error = alts.error ?? signups.error
  if (error) {
    console.error('Error counting pending alternate accounts:', error)
    return 0
  }
  const signedUp = new Set((signups.data ?? []).map((s) => s.profile_id))
  return (alts.data ?? []).filter((a) => !signedUp.has(a.profile_id)).length
}

function countAll() {
  return Promise.all([
    countPending('player_signups'),
    countStandaloneAlts(),
    countPending('comment_reports'),
    countPending('review_flags'),
    countPending('bug_reports'),
    countPending('match_result_reports'),
  ])
}

export async function getAdminPendingCounts(): Promise<AdminPendingCounts> {
  const [signups, riotAccounts, commentReports, reviewFlags, bugReports] = await countAll()

  return {
    moderation: commentReports + reviewFlags + bugReports,
    signups: signups + riotAccounts,
  }
}

export type AdminQueueItem = {
  key: string
  label: string
  count: number
  /** Deep link into the admin tab that holds the queue. */
  link: string
}

/*
 * The same queues, broken out for the header bell so an admin browsing the
 * public site sees what is waiting. These are live counts rather than stored
 * notifications: a queue item resolved by any admin disappears for all of
 * them, and nothing has to be fanned out or cleaned up per admin.
 */
export async function getAdminQueue(): Promise<AdminQueueItem[]> {
  const [signups, riotAccounts, commentReports, reviewFlags, bugReports, resultReports] =
    await countAll()

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const items: AdminQueueItem[] = [
    {
      key: 'signups',
      label: plural(signups, 'player signup', 'player signups'),
      count: signups,
      link: '/admin?tab=signups',
    },
    {
      key: 'riot_accounts',
      label: plural(riotAccounts, 'alternate Riot account', 'alternate Riot accounts'),
      count: riotAccounts,
      link: '/admin?tab=signups',
    },
    {
      key: 'result_reports',
      label: plural(resultReports, 'match result report', 'match result reports'),
      count: resultReports,
      link: '/admin?tab=matches',
    },
    {
      key: 'comment_reports',
      label: plural(commentReports, 'reported comment', 'reported comments'),
      count: commentReports,
      link: '/admin?tab=moderation',
    },
    {
      key: 'review_flags',
      label: plural(reviewFlags, 'data flag', 'data flags'),
      count: reviewFlags,
      link: '/admin?tab=moderation',
    },
    {
      key: 'bug_reports',
      label: plural(bugReports, 'bug report', 'bug reports'),
      count: bugReports,
      link: '/admin?tab=moderation',
    },
  ]
  return items.filter((item) => item.count > 0)
}
