import { logAdminAction } from '$lib/server/audit/admin-actions'
import { supabaseAdmin } from '$lib/supabase/admin'

export class MatchLifecycleError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'MatchLifecycleError'
  }
}

type MatchRow = {
  id: string
  team_a_id: string
  team_b_id: string
  status: string | null
  approval_status?: string | null
  team_a_score?: number | null
  team_b_score?: number | null
  metadata?: Record<string, unknown> | null
}

type ResultReportRow = {
  id: string
  match_id: string
  status: string
  team_a_score: number
  team_b_score: number
  winner_team_id: string
  reporting_team_id?: string | null
  reported_by_profile_id?: string | null
}

export type MatchLifecycleRepository = {
  getMatchForLifecycle(matchId: string): Promise<MatchRow | null>
  updateMatch(matchId: string, patch: Record<string, unknown>, select?: string): Promise<unknown>
  getResultReport(reportId: string): Promise<ResultReportRow | null>
  updateResultReport(
    reportId: string,
    patch: Record<string, unknown>,
    select?: string
  ): Promise<unknown>
  logAdminAction?(input: {
    adminProfileId: string
    actionType: string
    targetTable: string
    targetId: string
    details: Record<string, unknown>
  }): Promise<void>
  now(): string
}

export function createSupabaseMatchLifecycleRepository(): MatchLifecycleRepository {
  return {
    now: () => new Date().toISOString(),
    async getMatchForLifecycle(matchId) {
      const { data, error } = await supabaseAdmin
        .from('matches')
        .select(
          'id, team_a_id, team_b_id, status, approval_status, team_a_score, team_b_score, metadata'
        )
        .eq('id', matchId)
        .single()
      if (error || !data) return null
      return data as MatchRow
    },
    async updateMatch(
      matchId,
      patch,
      select = 'id, status, winner_team_id, team_a_score, team_b_score'
    ) {
      const { data, error } = await supabaseAdmin
        .from('matches')
        .update(patch)
        .eq('id', matchId)
        .select(select)
        .single()
      if (error || !data) throw new MatchLifecycleError(500, 'Failed to update match')
      return data
    },
    async getResultReport(reportId) {
      const { data, error } = await supabaseAdmin
        .from('match_result_reports')
        .select(
          'id, match_id, status, team_a_score, team_b_score, winner_team_id, reporting_team_id, reported_by_profile_id'
        )
        .eq('id', reportId)
        .single()
      if (error || !data) return null
      return data as ResultReportRow
    },
    async updateResultReport(reportId, patch, select = 'id, status') {
      const { data, error } = await supabaseAdmin
        .from('match_result_reports')
        .update(patch)
        .eq('id', reportId)
        .select(select)
        .single()
      if (error || !data) throw new MatchLifecycleError(500, 'Failed to update result report')
      return data
    },
    logAdminAction,
  }
}

function assertFiniteScore(value: number, label: string) {
  if (!Number.isFinite(value)) throw new MatchLifecycleError(400, `${label} is required`)
}

function assertWinner(match: MatchRow, winnerTeamId: string | null) {
  if (!winnerTeamId || ![match.team_a_id, match.team_b_id].includes(winnerTeamId)) {
    throw new MatchLifecycleError(400, 'Winner team must be one of the match teams')
  }
}

export async function finalizeMatch(
  input: {
    matchId: string
    adminProfileId: string
    teamAScore: number
    teamBScore: number
    winnerTeamId: string | null
  },
  repo: MatchLifecycleRepository = createSupabaseMatchLifecycleRepository()
) {
  const match = await repo.getMatchForLifecycle(input.matchId)
  if (!match) throw new MatchLifecycleError(404, 'Match not found')

  assertFiniteScore(input.teamAScore, 'Scores')
  assertFiniteScore(input.teamBScore, 'Scores')
  assertWinner(match, input.winnerTeamId)

  return repo.updateMatch(input.matchId, {
    status: 'completed',
    approval_status: 'approved',
    winner_team_id: input.winnerTeamId,
    team_a_score: input.teamAScore,
    team_b_score: input.teamBScore,
    ended_at: repo.now(),
    approved_by_profile_id: input.adminProfileId,
    approved_at: repo.now(),
  })
}

export async function cancelMatch(
  input: { matchId: string; adminProfileId: string },
  repo: MatchLifecycleRepository = createSupabaseMatchLifecycleRepository()
) {
  const match = await repo.getMatchForLifecycle(input.matchId)
  if (!match) throw new MatchLifecycleError(404, 'Match not found')

  return repo.updateMatch(
    input.matchId,
    {
      status: 'cancelled',
      approval_status: 'approved',
      approved_by_profile_id: input.adminProfileId,
      approved_at: repo.now(),
    },
    'id, status, approval_status'
  )
}

export async function updateMatchDetails(
  input: {
    matchId: string
    adminProfileId: string
    teamAId: string | null
    teamBId: string | null
    bestOf: number
    status: string | null
    scheduledAt: string | null
    teamAScore: number
    teamBScore: number
    winnerTeamId: string | null
    youtubeVodUrl: string | null
    mapVetoes: string[]
    designation: string | null
    /** Omitted leaves the match where it is; null files it under no season. */
    seasonId?: string | null | undefined
  },
  repo: MatchLifecycleRepository = createSupabaseMatchLifecycleRepository()
) {
  const match = await repo.getMatchForLifecycle(input.matchId)
  if (!match) throw new MatchLifecycleError(404, 'Match not found')

  if (!input.teamAId || !input.teamBId)
    throw new MatchLifecycleError(400, 'Both teams are required')
  if (input.teamAId === input.teamBId) throw new MatchLifecycleError(400, 'Teams must be different')
  if (![3, 5].includes(input.bestOf))
    throw new MatchLifecycleError(400, 'bestOf must be one of 3 or 5')
  if (input.status && !['scheduled', 'live', 'completed', 'cancelled'].includes(input.status)) {
    throw new MatchLifecycleError(400, 'Invalid match status')
  }
  if (input.winnerTeamId && ![input.teamAId, input.teamBId].includes(input.winnerTeamId)) {
    throw new MatchLifecycleError(400, 'Winner team must be one of the selected teams')
  }

  const nextStatus = input.status ?? match.status
  return repo.updateMatch(
    input.matchId,
    {
      team_a_id: input.teamAId,
      team_b_id: input.teamBId,
      best_of: input.bestOf,
      status: nextStatus,
      scheduled_at: input.scheduledAt,
      team_a_score: Number.isFinite(input.teamAScore) ? input.teamAScore : 0,
      team_b_score: Number.isFinite(input.teamBScore) ? input.teamBScore : 0,
      winner_team_id: input.winnerTeamId,
      ended_at: nextStatus === 'completed' ? repo.now() : null,
      metadata: {
        ...(match.metadata ?? {}),
        youtube_vod_url: input.youtubeVodUrl,
        map_vetoes: input.mapVetoes,
        designation: input.designation,
      },
      approved_by_profile_id: input.adminProfileId,
      approved_at: repo.now(),
      // Only touched when the caller supplied a value, so ordinary edits
      // cannot silently move a match out of its season.
      ...(input.seasonId !== undefined ? { season_id: input.seasonId } : {}),
    },
    'id, status, team_a_id, team_b_id, winner_team_id, team_a_score, team_b_score, scheduled_at'
  )
}

export async function reviewResultReport(
  input: {
    reportId: string
    adminProfileId: string
    action: 'approve' | 'reject'
    reviewNotes: string | null
  },
  repo: MatchLifecycleRepository = createSupabaseMatchLifecycleRepository()
) {
  const report = await repo.getResultReport(input.reportId)
  if (!report) throw new MatchLifecycleError(404, 'Result report not found')
  if (report.status !== 'pending')
    throw new MatchLifecycleError(409, 'Result report is not pending')

  const match = await repo.getMatchForLifecycle(report.match_id)
  if (!match) throw new MatchLifecycleError(404, 'Match not found')
  if (match.approval_status !== 'approved')
    throw new MatchLifecycleError(409, 'Match is not approved')
  if (['completed', 'cancelled'].includes(match.status ?? '')) {
    throw new MatchLifecycleError(409, 'Match is already finished')
  }
  assertWinner(match, report.winner_team_id)

  if (input.action === 'reject') {
    const updatedReport = await repo.updateResultReport(input.reportId, {
      status: 'rejected',
      reviewed_by_profile_id: input.adminProfileId,
      reviewed_at: repo.now(),
      review_notes: input.reviewNotes,
    })
    await repo.logAdminAction?.({
      adminProfileId: input.adminProfileId,
      actionType: 'match_result_report_rejected',
      targetTable: 'match_result_reports',
      targetId: input.reportId,
      details: { match_id: report.match_id, review_notes: input.reviewNotes },
    })
    return { report: updatedReport }
  }

  const updatedMatch = await finalizeMatch(
    {
      matchId: report.match_id,
      adminProfileId: input.adminProfileId,
      teamAScore: report.team_a_score,
      teamBScore: report.team_b_score,
      winnerTeamId: report.winner_team_id,
    },
    repo
  )

  const updatedReport = await repo.updateResultReport(input.reportId, {
    status: 'approved',
    reviewed_by_profile_id: input.adminProfileId,
    reviewed_at: repo.now(),
    review_notes: input.reviewNotes,
  })

  await repo.logAdminAction?.({
    adminProfileId: input.adminProfileId,
    actionType: 'match_result_report_approved',
    targetTable: 'match_result_reports',
    targetId: input.reportId,
    details: {
      match_id: report.match_id,
      winner_team_id: report.winner_team_id,
      team_a_score: report.team_a_score,
      team_b_score: report.team_b_score,
      review_notes: input.reviewNotes,
    },
  })

  return { match: updatedMatch, report: updatedReport }
}
