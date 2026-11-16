import { adminJsonRequest } from '$lib/admin/api'
import type { BugReport, CommentReport, ReviewFlag } from '$lib/admin/types'
import type { AdminMessages } from '$lib/admin/signups.svelte'

/*
 * State and actions for the admin Moderation tab: reported comments,
 * commenting bans, data flags and bug reports. Lives on the page so the loaded
 * queues survive switching tabs.
 */
export class ModerationAdmin {
  private ui: AdminMessages
  private refreshPendingCounts: () => Promise<unknown>

  constructor(ui: AdminMessages, refreshPendingCounts: () => Promise<unknown>) {
    this.ui = ui
    this.refreshPendingCounts = refreshPendingCounts
  }

  // ---- Comment moderation ----
  commentReports = $state<CommentReport[]>([])
  commentReportsLoaded = $state(false)
  commentReportStatusFilter = $state('pending')
  processingReportId = $state<string | null>(null)

  // ---- Data flags (user-submitted "this looks wrong" reports) ----
  reviewFlags = $state<ReviewFlag[]>([])
  reviewFlagsLoaded = $state(false)
  processingFlagId = $state<string | null>(null)

  // ---- Bug reports (site-wide "something's broken" reports) ----
  bugReports = $state<BugReport[]>([])
  bugReportsLoaded = $state(false)
  processingBugReportId = $state<string | null>(null)

  loadBugReports = async () => {
    try {
      const result = await adminJsonRequest<{ reports?: BugReport[] }>(
        `/api/admin/bug-reports?status=${encodeURIComponent(this.commentReportStatusFilter)}`,
        { fallbackMessage: 'Failed to load bug reports' }
      )
      this.bugReports = result.reports ?? []
      this.bugReportsLoaded = true
    } catch (err) {
      this.ui.error = err instanceof Error ? err.message : 'Failed to load bug reports'
    }
  }

  bugReportAction = async (
    reportId: string,
    action: 'resolve' | 'dismiss',
    successText: string
  ) => {
    this.processingBugReportId = reportId
    this.ui.error = null
    this.ui.success = null
    try {
      await adminJsonRequest('/api/admin/bug-reports', {
        method: 'PATCH',
        body: { action, reportId },
        fallbackMessage: 'Bug report action failed',
      })
      this.ui.success = successText
      await Promise.all([this.loadBugReports(), this.refreshPendingCounts()])
    } catch (err) {
      this.ui.error = err instanceof Error ? err.message : 'Bug report action failed'
    } finally {
      this.processingBugReportId = null
    }
  }

  resolveBugReport = (reportId: string) => {
    return this.bugReportAction(reportId, 'resolve', 'Bug report resolved.')
  }

  dismissBugReport = (reportId: string) => {
    return this.bugReportAction(reportId, 'dismiss', 'Bug report dismissed.')
  }

  loadReviewFlags = async () => {
    try {
      const result = await adminJsonRequest<{ flags?: ReviewFlag[] }>(
        `/api/admin/review-flags?status=${encodeURIComponent(this.commentReportStatusFilter)}`,
        { fallbackMessage: 'Failed to load flags' }
      )
      this.reviewFlags = result.flags ?? []
      this.reviewFlagsLoaded = true
    } catch (err) {
      this.ui.error = err instanceof Error ? err.message : 'Failed to load flags'
    }
  }

  flagAction = async (flagId: string, action: 'resolve' | 'dismiss', successText: string) => {
    this.processingFlagId = flagId
    this.ui.error = null
    this.ui.success = null
    try {
      await adminJsonRequest('/api/admin/review-flags', {
        method: 'PATCH',
        body: { action, flagId },
        fallbackMessage: 'Flag action failed',
      })
      this.ui.success = successText
      await Promise.all([this.loadReviewFlags(), this.refreshPendingCounts()])
    } catch (err) {
      this.ui.error = err instanceof Error ? err.message : 'Flag action failed'
    } finally {
      this.processingFlagId = null
    }
  }

  resolveFlag = (flagId: string) => {
    return this.flagAction(flagId, 'resolve', 'Flag resolved.')
  }

  dismissFlag = (flagId: string) => {
    return this.flagAction(flagId, 'dismiss', 'Flag dismissed.')
  }

  loadCommentReports = async () => {
    try {
      const result = await adminJsonRequest<{ reports?: CommentReport[] }>(
        `/api/admin/comment-reports?status=${encodeURIComponent(this.commentReportStatusFilter)}`,
        { fallbackMessage: 'Failed to load reports' }
      )
      this.commentReports = result.reports ?? []
      this.commentReportsLoaded = true
    } catch (err) {
      this.ui.error = err instanceof Error ? err.message : 'Failed to load reports'
    }
  }

  moderationAction = async (
    reportId: string | null,
    body: Record<string, unknown>,
    successText: string
  ) => {
    this.processingReportId = reportId
    this.ui.error = null
    this.ui.success = null
    try {
      await adminJsonRequest('/api/admin/comment-reports', {
        method: 'PATCH',
        body,
        fallbackMessage: 'Moderation action failed',
      })
      this.ui.success = successText
      await Promise.all([this.loadCommentReports(), this.refreshPendingCounts()])
    } catch (err) {
      this.ui.error = err instanceof Error ? err.message : 'Moderation action failed'
    } finally {
      this.processingReportId = null
    }
  }

  resolveReport = (reportId: string) => {
    return this.moderationAction(reportId, { action: 'resolve', reportId }, 'Report resolved.')
  }

  dismissReport = (reportId: string) => {
    return this.moderationAction(reportId, { action: 'dismiss', reportId }, 'Report dismissed.')
  }

  deleteReportedComment = (commentId: string, reportId: string) => {
    if (!window.confirm('Delete this comment? Replies to it will remain.')) return
    return this.moderationAction(
      reportId,
      { action: 'delete_comment', commentId },
      'Comment deleted.'
    )
  }

  banFromCommenting = (profileId: string, name: string) => {
    const input = window.prompt(
      `Ban ${name} from commenting.\n\nEnter the number of days, or leave blank for a permanent ban.`,
      '7'
    )
    if (input === null) return

    const days = input.trim() === '' ? 0 : Number(input)
    if (input.trim() !== '' && (!Number.isFinite(days) || days < 0)) {
      this.ui.error = 'Enter a positive number of days, or leave it blank for permanent.'
      return
    }

    const reason = window.prompt('Reason shown to the user (optional):') ?? null
    return this.moderationAction(
      null,
      { action: 'ban', profileId, days, reason },
      days > 0 ? `${name} banned for ${days} day(s).` : `${name} banned permanently.`
    )
  }

  unbanFromCommenting = (profileId: string, name: string) => {
    if (!window.confirm(`Lift the commenting ban on ${name}?`)) return
    return this.moderationAction(null, { action: 'unban', profileId }, `Ban lifted for ${name}.`)
  }
}
