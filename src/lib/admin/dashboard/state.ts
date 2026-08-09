import type { AdminMatch, BestOfValue, MatchEditState, MatchStreamFormState } from '../types'
import { teamName } from '../match-ui'

type DashboardData = {
  users: unknown[]
  seasons: unknown[]
  approved: unknown[]
  matches: AdminMatch[]
}

type FetchAdapter = {
  json<T>(
    input: string,
    options: {
      method?: string
      body?: unknown
      fallbackMessage: string
      includeHttpStatusInError?: boolean
    }
  ): Promise<T>
  form<T>(
    input: string,
    options: {
      method: string
      body: FormData
      fallbackMessage: string
      includeHttpStatusInError?: boolean
    }
  ): Promise<T>
  fetchDashboardData(options?: { seasonId?: string | null }): Promise<DashboardData>
}

export type DashboardStatusSink = {
  setLoading(value: boolean): void
  setError(message: string | null): void
  setSuccess(message: string | null): void
  replaceData(data: DashboardData): void
}

export function createAdminDashboardState({ fetchAdapter }: { fetchAdapter: FetchAdapter }) {
  async function refresh(sink: DashboardStatusSink & { seasonId?: string | null }) {
    sink.setLoading(true)
    sink.setError(null)
    sink.setSuccess(null)
    try {
      sink.replaceData(await fetchAdapter.fetchDashboardData({ seasonId: sink.seasonId }))
    } catch (err) {
      sink.setError(err instanceof Error ? err.message : 'Failed to refresh data')
    } finally {
      sink.setLoading(false)
    }
  }

  return {
    async refresh(sink: DashboardStatusSink & { seasonId?: string | null }) {
      await refresh(sink)
    },

    buildFinalizeConfirmation(
      match: AdminMatch,
      state: {
        teamAScore: string
        teamBScore: string
        winnerTeamId: string
      }
    ) {
      return {
        kind: 'finalize_match' as const,
        matchId: match.id,
        teamAScore: state.teamAScore,
        teamBScore: state.teamBScore,
        winnerTeamId: state.winnerTeamId,
        title: 'Confirm Match Finalization',
        message: `Finalize ${teamName(match.team_a)} vs ${teamName(match.team_b)} at ${state.teamAScore}-${state.teamBScore}? This will mark the result official.`,
        confirmLabel: 'Finalize Match',
      }
    },

    buildCancelConfirmation(match: AdminMatch) {
      return {
        kind: 'cancel_match' as const,
        matchId: match.id,
        title: 'Confirm Match Cancellation',
        message: `Cancel ${teamName(match.team_a)} vs ${teamName(match.team_b)}? This will keep the match record but mark it cancelled.`,
        confirmLabel: 'Cancel Match',
      }
    },

    async createMatch(input: {
      teamAId: string
      teamBId: string
      bestOf: BestOfValue
      scheduledAt: string
    }) {
      if (!input.teamAId || !input.teamBId) return { error: 'Select both teams' }
      if (input.teamAId === input.teamBId) return { error: 'Teams must be different' }

      await fetchAdapter.json('/api/admin/matches', {
        method: 'POST',
        body: {
          teamAId: input.teamAId,
          teamBId: input.teamBId,
          bestOf: Number(input.bestOf),
          scheduledAt: input.scheduledAt || null,
        },
        fallbackMessage: 'Failed to create match',
      })
      return { success: 'Match created.' }
    },

    async finalizeMatch(input: {
      matchId: string
      teamAScore: string
      teamBScore: string
      winnerTeamId: string
    }) {
      await fetchAdapter.json(`/api/admin/matches/${input.matchId}`, {
        method: 'PATCH',
        body: {
          action: 'finalize',
          winnerTeamId: input.winnerTeamId,
          teamAScore: Number(input.teamAScore),
          teamBScore: Number(input.teamBScore),
        },
        fallbackMessage: 'Failed to finalize match',
      })
      return { success: 'Match finalized.' }
    },

    async cancelMatch(matchId: string) {
      await fetchAdapter.json(`/api/admin/matches/${matchId}`, {
        method: 'PATCH',
        body: { action: 'cancel' },
        fallbackMessage: 'Failed to cancel match',
      })
      return { success: 'Match cancelled.' }
    },

    async saveMatch(matchId: string, state: MatchEditState, vodUrl: string | null) {
      await fetchAdapter.json(`/api/admin/matches/${matchId}`, {
        method: 'PATCH',
        body: {
          action: 'update',
          teamAId: state.teamAId,
          teamBId: state.teamBId,
          bestOf: Number(state.bestOf),
          status: state.status,
          scheduledAt: state.scheduledAt || null,
          teamAScore: Number(state.teamAScore),
          teamBScore: Number(state.teamBScore),
          winnerTeamId: state.winnerTeamId || null,
          youtubeVodUrl: vodUrl || null,
          mapVetoes: state.mapVetoes || '',
          designation: state.designation || null,
        },
        fallbackMessage: 'Failed to update match',
      })
      return { success: 'Match updated.' }
    },

    async deleteMatch(matchId: string) {
      await fetchAdapter.json(`/api/admin/matches/${matchId}`, {
        method: 'DELETE',
        fallbackMessage: 'Failed to delete match',
      })
      return { success: 'Match deleted.' }
    },

    async addMatchStream(matchId: string, state: MatchStreamFormState) {
      if (!state.streamUrl.trim()) return { error: 'Stream URL is required' }
      await fetchAdapter.json(`/api/admin/matches/${matchId}/streams`, {
        method: 'POST',
        body: state,
        fallbackMessage: 'Failed to add stream',
      })
      return { success: 'Stream added.' }
    },

    async saveExistingMatchStream(matchId: string, streamId: string, state: MatchStreamFormState) {
      if (!state.streamUrl.trim()) return { error: 'Stream URL is required' }
      await fetchAdapter.json(`/api/admin/matches/${matchId}/streams`, {
        method: 'PATCH',
        body: {
          streamId,
          platform: state.platform,
          streamUrl: state.streamUrl,
          displayName: state.displayName,
          status: state.status,
          isPrimary: state.isPrimary,
        },
        fallbackMessage: 'Failed to update stream',
      })
      return { success: 'Stream updated.' }
    },

    async removeMatchStream(matchId: string, streamId: string) {
      await fetchAdapter.json(`/api/admin/matches/${matchId}/streams`, {
        method: 'DELETE',
        body: { streamId },
        fallbackMessage: 'Failed to remove stream',
      })
      return { success: 'Stream removed.' }
    },

    async createTeam(input: { name: string; tag: string; logoFile: File | null }) {
      if (!input.name.trim()) return { error: 'Team name is required' }
      const form = new FormData()
      form.set('name', input.name)
      form.set('tag', input.tag)
      if (input.logoFile) form.set('logo', input.logoFile)
      await fetchAdapter.form('/api/admin/teams', {
        method: 'POST',
        body: form,
        fallbackMessage: 'Failed to create team',
        includeHttpStatusInError: true,
      })
      return { success: 'Team created.' }
    },

    async saveTeam(
      teamId: string,
      input: { name: string; tag: string; status: string; logoFile: File | null }
    ) {
      const form = new FormData()
      form.set('name', input.name ?? '')
      form.set('tag', input.tag ?? '')
      form.set('status', input.status ?? 'active')
      if (input.logoFile) form.set('logo', input.logoFile)
      await fetchAdapter.form(`/api/admin/teams/${teamId}`, {
        method: 'PATCH',
        body: form,
        fallbackMessage: 'Failed to update team',
      })
      return { success: 'Team updated.' }
    },

    async addPlayerToTeam(teamId: string, input: { playerName: string; role: string }) {
      if (!input.playerName.trim()) return { error: 'Enter a player name to add' }
      await fetchAdapter.json('/api/admin/teams/manage', {
        method: 'POST',
        body: { teamId, playerName: input.playerName.trim(), role: input.role },
        fallbackMessage: 'Failed to add player',
      })
      return { success: 'Player added to team.' }
    },

    async removeApprovedTeam(teamId: string) {
      await fetchAdapter.json('/api/admin/teams/manage', {
        method: 'DELETE',
        body: { teamId },
        fallbackMessage: 'Failed to remove team',
      })
      return { success: 'Team removed.' }
    },

    async removeApprovedTeamPlayer(teamId: string, membershipId: number | null, profileId: string) {
      await fetchAdapter.json('/api/admin/teams/manage', {
        method: 'PATCH',
        body: { teamId, profileId: profileId || null, membershipId },
        fallbackMessage: 'Failed to remove player',
      })
      return { success: 'Player removed.' }
    },

    async createSeason(input: {
      code: string
      name: string
      startsOn: string
      endsOn: string
      isActive: boolean
    }) {
      if (!input.code.trim() || !input.name.trim()) {
        return { error: 'Season code and name are required' }
      }
      await fetchAdapter.json('/api/admin/seasons', {
        method: 'POST',
        body: {
          code: input.code,
          name: input.name,
          startsOn: input.startsOn || null,
          endsOn: input.endsOn || null,
          isActive: input.isActive,
        },
        fallbackMessage: 'Failed to create season',
      })
      return { success: 'Season created.' }
    },

    async saveSeason(
      seasonId: string,
      input: { code: string; name: string; startsOn: string; endsOn: string; isActive: boolean }
    ) {
      await fetchAdapter.json('/api/admin/seasons', {
        method: 'PATCH',
        body: {
          id: seasonId,
          code: input.code,
          name: input.name,
          startsOn: input.startsOn || null,
          endsOn: input.endsOn || null,
          isActive: Boolean(input.isActive),
        },
        fallbackMessage: 'Failed to update season',
      })
      return { success: 'Season updated.' }
    },

    async saveUserRiotId(userId: string, riotIdBase: string) {
      await fetchAdapter.json('/api/admin/users', {
        method: 'PATCH',
        body: { userId, riotIdBase },
        fallbackMessage: 'Failed to update Riot ID',
      })
      return { success: 'Riot ID updated.' }
    },

    async updateUserRole(userId: string, newRole: string) {
      await fetchAdapter.json('/api/admin/users', {
        method: 'PATCH',
        body: { userId, newRole },
        fallbackMessage: 'Failed to update role',
      })
      return { success: `Updated role to ${newRole}.` }
    },
  }
}
