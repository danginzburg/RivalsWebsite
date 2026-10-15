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
async function countPending(table: string, nonPrimaryOnly = false): Promise<number> {
  let query = supabaseAdmin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  // Primary Riot accounts are never reviewed; only alternates enter the queue.
  if (nonPrimaryOnly) query = query.eq('is_primary', false)
  const { count, error } = await query
  if (error) {
    console.error(`Error counting pending ${table}:`, error)
    return 0
  }
  return count ?? 0
}

export async function getAdminPendingCounts(): Promise<AdminPendingCounts> {
  const [signups, riotAccounts, commentReports, reviewFlags, bugReports] = await Promise.all([
    countPending('player_signups'),
    countPending('profile_riot_accounts', true),
    countPending('comment_reports'),
    countPending('review_flags'),
    countPending('bug_reports'),
  ])

  return {
    moderation: commentReports + reviewFlags + bugReports,
    signups: signups + riotAccounts,
  }
}
