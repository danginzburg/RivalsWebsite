<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { teamName, toDatetimeLocal } from '$lib/admin/match-ui'
  import { adminFormRequest, adminJsonRequest, fetchAdminDashboardData } from '$lib/admin/api'
  import {
    buildApprovedTeamOptions,
    filterAdminMatches,
    normalizeSearchValue,
    profileLabel,
  } from '$lib/admin/ui'
  import AdminDashboardShell from '$lib/components/admin/AdminDashboardShell.svelte'
  import AdminMatchesTab from '$lib/components/admin/AdminMatchesTab.svelte'
  import AdminSeasonsTab from '$lib/components/admin/AdminSeasonsTab.svelte'
  import AdminTeamsTab from '$lib/components/admin/AdminTeamsTab.svelte'
  import AdminUsersTab from '$lib/components/admin/AdminUsersTab.svelte'
  import AdminActionConfirmationModal from '$lib/components/admin/AdminActionConfirmationModal.svelte'
  import type {
    ApprovedTeamEntry,
    AdminPageDataExtras,
    AdminTabId,
    BestOfValue,
    PendingActionConfirmation,
    PendingRoleChange,
  } from '$lib/admin/types'
  import type { PageData, PageProps } from './$types'

  let { data: pageData }: PageProps = $props()

  /** Server load plus optional fields referenced before client fetch populates them. */
  type AdminPageData = PageData & AdminPageDataExtras & { leaderboardBatches?: unknown[] }

  const data = $derived(pageData as AdminPageData)

  let activeTab = $state<AdminTabId>('matches')
  let isLoading = $state(false)
  let errorMessage = $state<string | null>(null)
  let successMessage = $state<string | null>(null)

  const getInitialUsers = () => data.users || []
  const getInitialSeasons = () => data.seasons || []
  const getInitialLeaderboardBatches = () => data.leaderboardBatches || []
  const getInitialApprovedTeams = () => data.approvedTeams || []
  const getInitialMatches = () => data.matches || []

  let users = $state<any[]>(getInitialUsers())
  let seasons = $state<any[]>(getInitialSeasons())
  let leaderboardBatches = $state<any[]>(getInitialLeaderboardBatches())
  let approvedTeams = $state<ApprovedTeamEntry[]>(getInitialApprovedTeams() as ApprovedTeamEntry[])
  let matches = $state<any[]>(getInitialMatches())
  let matchSearchQuery = $state('')
  let showCompletedAdminMatches = $state(false)
  let createSeasonCode = $state('')
  let createSeasonName = $state('')
  let createSeasonStartsOn = $state('')
  let createSeasonEndsOn = $state('')
  let createSeasonIsActive = $state(false)
  let isCreatingSeason = $state(false)
  let seasonEditForm = $state<Record<string, any>>({})

  const approvedTeamOptions = $derived(buildApprovedTeamOptions(approvedTeams ?? []))

  let createMatchTeamAId = $state('')
  let createMatchTeamBId = $state('')
  let createMatchBestOf = $state<BestOfValue>('3')
  let createMatchScheduledAt = $state('')
  let isCreatingMatch = $state(false)
  let expandedAdminMatchId = $state<string | null>(null)

  const filteredAdminMatches = $derived(
    filterAdminMatches(matches ?? [], matchSearchQuery, showCompletedAdminMatches)
  )

  let createTeamName = $state('')
  let createTeamTag = $state('')
  let createTeamLogoFile = $state<File | null>(null)
  let isCreatingTeam = $state(false)

  let addPlayerForm = $state<Record<string, { playerName: string; role: string }>>({})
  let teamEditForm = $state<Record<string, any>>({})
  let teamLogoFileById = $state<Record<string, File | null>>({})

  function updateAddPlayerForm(
    teamId: string,
    patch: Partial<{ playerName: string; role: string }>
  ) {
    const current = addPlayerForm[teamId] ?? { playerName: '', role: 'player' }
    addPlayerForm = {
      ...addPlayerForm,
      [teamId]: {
        ...current,
        ...patch,
      },
    }
  }

  $effect(() => {
    // Ensure per-team form state exists without mutating during render.
    const ids = new Set((approvedTeams ?? []).map((t) => t.id))
    const next: Record<string, { playerName: string; role: string }> = {}
    for (const id of ids) {
      next[id] = addPlayerForm[id] ?? { playerName: '', role: 'player' }
    }
    // Preserve object identity when no changes.
    const prevKeys = Object.keys(addPlayerForm)
    const nextKeys = Object.keys(next)
    const changed =
      prevKeys.length !== nextKeys.length ||
      nextKeys.some(
        (k) =>
          !addPlayerForm[k] ||
          addPlayerForm[k].playerName !== next[k].playerName ||
          addPlayerForm[k].role !== next[k].role
      )
    if (changed) addPlayerForm = next
  })

  function updateTeamEditForm(teamId: string, patch: Record<string, string>) {
    const current =
      teamEditForm[teamId] ??
      ({
        name: '',
        tag: '',
        status: 'active',
      } as const)
    teamEditForm = {
      ...teamEditForm,
      [teamId]: {
        ...current,
        ...patch,
      },
    }
  }

  $effect(() => {
    const next: Record<string, any> = {}
    const nextLogos: Record<string, File | null> = {}
    for (const team of approvedTeams ?? []) {
      next[team.id] = teamEditForm[team.id] ?? {
        name: team.name ?? '',
        tag: team.tag ?? '',
        status: (team as any).status ?? 'active',
      }
      nextLogos[team.id] = teamLogoFileById[team.id] ?? null
    }
    const teamKeys = Object.keys(next)
    const currentKeys = Object.keys(teamEditForm)
    const teamChanged =
      teamKeys.length !== currentKeys.length ||
      teamKeys.some(
        (key) => JSON.stringify(teamEditForm[key] ?? {}) !== JSON.stringify(next[key] ?? {})
      )
    if (teamChanged) teamEditForm = next

    const logoKeys = Object.keys(nextLogos)
    const currentLogoKeys = Object.keys(teamLogoFileById)
    const logoChanged =
      logoKeys.length !== currentLogoKeys.length ||
      logoKeys.some((key) => teamLogoFileById[key] !== nextLogos[key])
    if (logoChanged) teamLogoFileById = nextLogos
  })

  let createTeamLogoInput = $state<HTMLInputElement | null>(null)

  let finalizeForm = $state<
    Record<string, { teamAScore: string; teamBScore: string; winnerTeamId: string }>
  >({})
  let matchEditForm = $state<Record<string, any>>({})
  let streamForm = $state<
    Record<
      string,
      {
        platform: string
        streamUrl: string
        displayName: string
        status: string
        isPrimary: boolean
      }
    >
  >({})
  let existingStreamForm = $state<
    Record<
      string,
      {
        platform: string
        streamUrl: string
        displayName: string
        status: string
        isPrimary: boolean
      }
    >
  >({})
  let vodForm = $state<Record<string, string>>({})

  function updateFinalizeForm(
    matchId: string,
    patch: Partial<{ teamAScore: string; teamBScore: string; winnerTeamId: string }>
  ) {
    const current =
      finalizeForm[matchId] ?? ({ teamAScore: '0', teamBScore: '0', winnerTeamId: '' } as const)
    finalizeForm = {
      ...finalizeForm,
      [matchId]: {
        ...current,
        ...patch,
      },
    }
  }

  $effect(() => {
    const ids = new Set((matches ?? []).map((m) => m.id))
    const next: Record<string, { teamAScore: string; teamBScore: string; winnerTeamId: string }> =
      {}
    for (const m of matches ?? []) {
      const prev = finalizeForm[m.id]
      next[m.id] = prev ?? {
        teamAScore: String(m.team_a_score ?? 0),
        teamBScore: String(m.team_b_score ?? 0),
        winnerTeamId: m.winner_team_id ?? m.team_a_id,
      }
    }

    const prevKeys = Object.keys(finalizeForm)
    const nextKeys = Object.keys(next)
    const changed =
      prevKeys.length !== nextKeys.length ||
      nextKeys.some(
        (k) =>
          !finalizeForm[k] ||
          finalizeForm[k].teamAScore !== next[k].teamAScore ||
          finalizeForm[k].teamBScore !== next[k].teamBScore ||
          finalizeForm[k].winnerTeamId !== next[k].winnerTeamId
      ) ||
      prevKeys.some((k) => !ids.has(k))
    if (changed) finalizeForm = next
  })

  function updateMatchEditForm(matchId: string, patch: Record<string, string>) {
    const current =
      matchEditForm[matchId] ??
      ({
        teamAId: '',
        teamBId: '',
        bestOf: '3',
        status: 'scheduled',
        scheduledAt: '',
        teamAScore: '0',
        teamBScore: '0',
        winnerTeamId: '',
        mapVetoes: '',
      } as const)
    matchEditForm = {
      ...matchEditForm,
      [matchId]: {
        ...current,
        ...patch,
      },
    }
  }

  $effect(() => {
    const next: Record<string, any> = {}
    for (const match of matches ?? []) {
      next[match.id] = matchEditForm[match.id] ?? {
        teamAId: match.team_a_id,
        teamBId: match.team_b_id,
        bestOf: String(match.best_of ?? 3),
        status: match.status ?? 'scheduled',
        scheduledAt: toDatetimeLocal(match.scheduled_at),
        teamAScore: String(match.team_a_score ?? 0),
        teamBScore: String(match.team_b_score ?? 0),
        winnerTeamId: match.winner_team_id ?? '',
        mapVetoes: Array.isArray(match.metadata?.map_vetoes)
          ? match.metadata.map_vetoes.join('\n')
          : '',
      }
    }
    const keys = Object.keys(next)
    const currentKeys = Object.keys(matchEditForm)
    const changed =
      keys.length !== currentKeys.length ||
      keys.some(
        (key) => JSON.stringify(matchEditForm[key] ?? {}) !== JSON.stringify(next[key] ?? {})
      )
    if (changed) matchEditForm = next
  })

  $effect(() => {
    const next: Record<
      string,
      {
        platform: string
        streamUrl: string
        displayName: string
        status: string
        isPrimary: boolean
      }
    > = {}
    for (const match of matches ?? []) {
      next[match.id] = streamForm[match.id] ?? {
        platform: 'twitch',
        streamUrl: '',
        displayName: '',
        status: match.status === 'live' ? 'live' : 'scheduled',
        isPrimary: !(match.streams?.length > 0),
      }
    }
    const keys = Object.keys(next)
    const currentKeys = Object.keys(streamForm)
    const changed =
      keys.length !== currentKeys.length ||
      keys.some((key) => JSON.stringify(streamForm[key] ?? {}) !== JSON.stringify(next[key] ?? {}))
    if (changed) streamForm = next
  })

  $effect(() => {
    const next: Record<
      string,
      {
        platform: string
        streamUrl: string
        displayName: string
        status: string
        isPrimary: boolean
      }
    > = {}
    for (const match of matches ?? []) {
      for (const stream of match.streams ?? []) {
        next[stream.id] = existingStreamForm[stream.id] ?? {
          platform: stream.platform ?? 'twitch',
          streamUrl: stream.stream_url ?? '',
          displayName: stream.metadata?.display_name ?? '',
          status: stream.status ?? 'scheduled',
          isPrimary: Boolean(stream.is_primary),
        }
      }
    }
    const keys = Object.keys(next)
    const currentKeys = Object.keys(existingStreamForm)
    const changed =
      keys.length !== currentKeys.length ||
      keys.some(
        (key) => JSON.stringify(existingStreamForm[key] ?? {}) !== JSON.stringify(next[key] ?? {})
      )
    if (changed) existingStreamForm = next
  })

  $effect(() => {
    const next: Record<string, string> = {}
    for (const match of matches ?? []) {
      next[match.id] = vodForm[match.id] ?? match.vod_url ?? ''
    }
    const keys = Object.keys(next)
    const currentKeys = Object.keys(vodForm)
    const changed =
      keys.length !== currentKeys.length ||
      keys.some((key) => (vodForm[key] ?? '') !== (next[key] ?? ''))
    if (changed) vodForm = next
  })

  $effect(() => {
    const next: Record<string, any> = {}
    for (const season of seasons ?? []) {
      next[season.id] = seasonEditForm[season.id] ?? {
        code: season.code ?? '',
        name: season.name ?? '',
        startsOn: season.starts_on ?? '',
        endsOn: season.ends_on ?? '',
        isActive: Boolean(season.is_active),
        pickemEnabled: Boolean(season.pickem?.enabled),
        pickemLeaderboardBatchId: season.pickem?.leaderboard_batch_id ?? '',
        pickemBaselineCompletedRounds: String(season.pickem?.baseline_completed_rounds ?? 2),
        pickemLockAt: season.pickem?.lock_at ? String(season.pickem.lock_at).slice(0, 16) : '',
        pickemStatus: season.pickem?.status ?? 'draft',
      }
    }
    const keys = Object.keys(next)
    const currentKeys = Object.keys(seasonEditForm)
    const changed =
      keys.length !== currentKeys.length ||
      keys.some(
        (key) => JSON.stringify(seasonEditForm[key] ?? {}) !== JSON.stringify(next[key] ?? {})
      )
    if (changed) seasonEditForm = next
  })

  // Role change confirmation
  let showRoleConfirmation = $state(false)
  let pendingRoleChange = $state<PendingRoleChange | null>(null)
  let isUpdatingRole = $state(false)
  let usersSearch = $state('')
  let userRiotIdForm = $state<Record<string, string>>({})
  let teamsSearch = $state('')
  let processingTeamId = $state<string | null>(null)
  let showActionConfirmation = $state(false)
  let pendingActionConfirmation = $state<PendingActionConfirmation | null>(null)

  const displayedUsers = $derived.by(() => {
    const search = normalizeSearchValue(usersSearch)
    return users.filter((user) => {
      if (!search) return true
      const haystack =
        `${user.display_name ?? ''} ${user.email ?? ''} ${user.role ?? ''}`.toLowerCase()
      return haystack.includes(search)
    })
  })

  $effect(() => {
    const next: Record<string, string> = {}
    for (const user of users ?? []) {
      next[user.id] = userRiotIdForm[user.id] ?? user.riot_id_base ?? ''
    }
    const keys = Object.keys(next)
    const currentKeys = Object.keys(userRiotIdForm)
    const changed =
      keys.length !== currentKeys.length ||
      keys.some((key) => (userRiotIdForm[key] ?? '') !== (next[key] ?? ''))
    if (changed) userRiotIdForm = next
  })

  const displayedApprovedTeams = $derived.by(() => {
    const search = normalizeSearchValue(teamsSearch)
    return approvedTeams.filter((team) => {
      if (!search) return true
      const captain = profileLabel(team.captain_profile)
      const haystack = `${team.name ?? ''} ${team.tag ?? ''} ${captain}`.toLowerCase()
      return haystack.includes(search)
    })
  })

  async function refreshData() {
    isLoading = true
    errorMessage = null
    successMessage = null

    try {
      const dashboardData = await fetchAdminDashboardData()

      users = dashboardData.users
      seasons = dashboardData.seasons
      leaderboardBatches = dashboardData.leaderboardBatches
      approvedTeams = dashboardData.approved as ApprovedTeamEntry[]
      matches = dashboardData.matches
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to refresh data'
    } finally {
      isLoading = false
    }
  }

  async function finalizeMatch(match: any) {
    const state = finalizeForm[match.id] ?? {
      teamAScore: String(match.team_a_score ?? 0),
      teamBScore: String(match.team_b_score ?? 0),
      winnerTeamId: match.winner_team_id ?? match.team_a_id,
    }

    pendingActionConfirmation = {
      kind: 'finalize_match',
      matchId: match.id,
      teamAScore: state.teamAScore,
      teamBScore: state.teamBScore,
      winnerTeamId: state.winnerTeamId,
      title: 'Confirm Match Finalization',
      message: `Finalize ${teamName(match.team_a)} vs ${teamName(match.team_b)} at ${state.teamAScore}-${state.teamBScore}? This will mark the result official.`,
      confirmLabel: 'Finalize Match',
    }
    showActionConfirmation = true
  }

  async function executeFinalizeMatch(action: {
    matchId: string
    teamAScore: string
    teamBScore: string
    winnerTeamId: string
  }) {
    errorMessage = null
    successMessage = null

    try {
      await adminJsonRequest(`/api/admin/matches/${action.matchId}`, {
        method: 'PATCH',
        body: {
          action: 'finalize',
          winnerTeamId: action.winnerTeamId,
          teamAScore: Number(action.teamAScore),
          teamBScore: Number(action.teamBScore),
        },
        fallbackMessage: 'Failed to finalize match',
      })
      successMessage = 'Match finalized.'
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to finalize match'
    }
  }

  async function cancelMatch(match: any) {
    pendingActionConfirmation = {
      kind: 'cancel_match',
      matchId: match.id,
      title: 'Confirm Match Cancellation',
      message: `Cancel ${teamName(match.team_a)} vs ${teamName(match.team_b)}? This will keep the match record but mark it cancelled.`,
      confirmLabel: 'Cancel Match',
    }
    showActionConfirmation = true
  }

  async function executeCancelMatch(matchId: string) {
    errorMessage = null
    successMessage = null

    try {
      await adminJsonRequest(`/api/admin/matches/${matchId}`, {
        method: 'PATCH',
        body: { action: 'cancel' },
        fallbackMessage: 'Failed to cancel match',
      })
      successMessage = 'Match cancelled.'
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to cancel match'
    }
  }

  async function createMatch() {
    errorMessage = null
    successMessage = null

    if (!createMatchTeamAId || !createMatchTeamBId) {
      errorMessage = 'Select both teams'
      return
    }
    if (createMatchTeamAId === createMatchTeamBId) {
      errorMessage = 'Teams must be different'
      return
    }

    isCreatingMatch = true
    try {
      await adminJsonRequest('/api/admin/matches', {
        method: 'POST',
        body: {
          teamAId: createMatchTeamAId,
          teamBId: createMatchTeamBId,
          bestOf: Number(createMatchBestOf),
          scheduledAt: createMatchScheduledAt || null,
        },
        fallbackMessage: 'Failed to create match',
      })

      successMessage = 'Match created.'
      createMatchScheduledAt = ''
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to create match'
    } finally {
      isCreatingMatch = false
    }
  }

  async function createTeam() {
    errorMessage = null
    successMessage = null

    if (!createTeamName.trim()) {
      errorMessage = 'Team name is required'
      return
    }

    isCreatingTeam = true
    try {
      const form = new FormData()
      form.set('name', createTeamName)
      form.set('tag', createTeamTag)
      if (createTeamLogoFile) form.set('logo', createTeamLogoFile)

      await adminFormRequest('/api/admin/teams', {
        method: 'POST',
        body: form,
        fallbackMessage: 'Failed to create team',
        includeHttpStatusInError: true,
      })

      successMessage = 'Team created.'
      createTeamName = ''
      createTeamTag = ''
      createTeamLogoFile = null
      if (createTeamLogoInput) createTeamLogoInput.value = ''
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to create team'
    } finally {
      isCreatingTeam = false
    }
  }

  async function executeSaveTeamEdits(teamId: string) {
    const state = teamEditForm[teamId]
    if (!state) return

    processingTeamId = teamId
    errorMessage = null
    successMessage = null

    try {
      const form = new FormData()
      form.set('name', state.name ?? '')
      form.set('tag', state.tag ?? '')
      form.set('status', state.status ?? 'active')
      if (teamLogoFileById[teamId]) form.set('logo', teamLogoFileById[teamId]!)

      await adminFormRequest(`/api/admin/teams/${teamId}`, {
        method: 'PATCH',
        body: form,
        fallbackMessage: 'Failed to update team',
      })

      successMessage = 'Team updated.'
      teamLogoFileById = { ...teamLogoFileById, [teamId]: null }
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to update team'
    } finally {
      processingTeamId = null
    }
  }

  async function executeSaveMatchEdits(matchId: string) {
    const state = matchEditForm[matchId]
    if (!state) return

    errorMessage = null
    successMessage = null

    try {
      await adminJsonRequest(`/api/admin/matches/${matchId}`, {
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
          youtubeVodUrl: vodForm[matchId] || null,
          mapVetoes: state.mapVetoes || '',
        },
        fallbackMessage: 'Failed to update match',
      })

      successMessage = 'Match updated.'
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to update match'
    }
  }

  function saveTeamEdits(teamId: string, teamName: string) {
    pendingActionConfirmation = {
      kind: 'save_team',
      teamId,
      title: 'Confirm Team Update',
      message: `Save edits for ${teamName}? This updates public team details and import aliases.`,
      confirmLabel: 'Save Team Changes',
    }
    showActionConfirmation = true
  }

  function saveMatchEdits(matchId: string, match: any) {
    pendingActionConfirmation = {
      kind: 'save_match',
      matchId,
      title: 'Confirm Match Update',
      message: `Save edits for ${teamName(match.team_a)} vs ${teamName(match.team_b)}?`,
      confirmLabel: 'Save Match Changes',
    }
    showActionConfirmation = true
  }

  function deleteMatch(matchId: string, match: any) {
    pendingActionConfirmation = {
      kind: 'delete_match',
      matchId,
      title: 'Confirm Match Deletion',
      message: `Delete ${teamName(match.team_a)} vs ${teamName(match.team_b)} permanently? This is only for cleanup mistakes and cannot be undone.`,
      confirmLabel: 'Delete Match',
    }
    showActionConfirmation = true
  }

  async function executeDeleteMatch(matchId: string) {
    errorMessage = null
    successMessage = null
    try {
      await adminJsonRequest(`/api/admin/matches/${matchId}`, {
        method: 'DELETE',
        fallbackMessage: 'Failed to delete match',
      })
      successMessage = 'Match deleted.'
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to delete match'
    }
  }

  async function addMatchStream(matchId: string) {
    const state = streamForm[matchId]
    if (!state?.streamUrl?.trim()) {
      errorMessage = 'Stream URL is required'
      return
    }

    errorMessage = null
    successMessage = null
    try {
      await adminJsonRequest(`/api/admin/matches/${matchId}/streams`, {
        method: 'POST',
        body: state,
        fallbackMessage: 'Failed to add stream',
      })
      successMessage = 'Stream added.'
      streamForm = {
        ...streamForm,
        [matchId]: {
          platform: state.platform,
          streamUrl: '',
          displayName: '',
          status: state.status,
          isPrimary: false,
        },
      }
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to add stream'
    }
  }

  async function saveExistingMatchStream(matchId: string, streamId: string) {
    const state = existingStreamForm[streamId]
    if (!state?.streamUrl?.trim()) {
      errorMessage = 'Stream URL is required'
      return
    }

    errorMessage = null
    successMessage = null
    try {
      await adminJsonRequest(`/api/admin/matches/${matchId}/streams`, {
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
      successMessage = 'Stream updated.'
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to update stream'
    }
  }

  async function createSeason() {
    if (!createSeasonCode.trim() || !createSeasonName.trim()) {
      errorMessage = 'Season code and name are required'
      return
    }

    isCreatingSeason = true
    errorMessage = null
    successMessage = null
    try {
      await adminJsonRequest('/api/admin/seasons', {
        method: 'POST',
        body: {
          code: createSeasonCode,
          name: createSeasonName,
          startsOn: createSeasonStartsOn || null,
          endsOn: createSeasonEndsOn || null,
          isActive: createSeasonIsActive,
        },
        fallbackMessage: 'Failed to create season',
      })
      successMessage = 'Season created.'
      createSeasonCode = ''
      createSeasonName = ''
      createSeasonStartsOn = ''
      createSeasonEndsOn = ''
      createSeasonIsActive = false
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to create season'
    } finally {
      isCreatingSeason = false
    }
  }

  async function saveSeason(seasonId: string) {
    const state = seasonEditForm[seasonId]
    if (!state) return

    errorMessage = null
    successMessage = null
    try {
      await adminJsonRequest('/api/admin/seasons', {
        method: 'PATCH',
        body: {
          id: seasonId,
          code: state.code,
          name: state.name,
          startsOn: state.startsOn || null,
          endsOn: state.endsOn || null,
          isActive: Boolean(state.isActive),
          pickem: {
            enabled: Boolean(state.pickemEnabled),
            leaderboard_batch_id: state.pickemLeaderboardBatchId || null,
            participant_count: 24,
            baseline_completed_rounds: Math.max(
              1,
              Number(state.pickemBaselineCompletedRounds) || 2
            ),
            prediction_round: 3,
            lock_at: state.pickemLockAt ? new Date(state.pickemLockAt).toISOString() : null,
            status: state.pickemStatus || 'draft',
          },
        },
        fallbackMessage: 'Failed to update season',
      })
      successMessage = 'Season updated.'
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to update season'
    }
  }

  function requestUserRiotIdSave(userId: string, userName: string) {
    const riotIdBase = (userRiotIdForm[userId] ?? '').trim()
    pendingActionConfirmation = {
      kind: 'save_user_riot',
      userId,
      userName,
      riotIdBase,
      title: 'Confirm Riot ID Update',
      message: riotIdBase
        ? `Set ${userName}'s Riot ID to ${riotIdBase}?`
        : `Clear ${userName}'s Riot ID?`,
      confirmLabel: 'Save Riot ID',
    }
    showActionConfirmation = true
  }

  async function executeSaveUserRiotId(userId: string, riotIdBase: string) {
    errorMessage = null
    successMessage = null
    try {
      await adminJsonRequest('/api/admin/users', {
        method: 'PATCH',
        body: { userId, riotIdBase },
        fallbackMessage: 'Failed to update Riot ID',
      })
      successMessage = 'Riot ID updated.'
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to update Riot ID'
    }
  }

  function removeMatchStream(matchId: string, streamId: string, label: string) {
    pendingActionConfirmation = {
      kind: 'delete_stream',
      matchId,
      streamId,
      title: 'Confirm Stream Removal',
      message: `Remove stream ${label}? This will remove it from the public match page.`,
      confirmLabel: 'Remove Stream',
    }
    showActionConfirmation = true
  }

  async function executeRemoveMatchStream(matchId: string, streamId: string) {
    errorMessage = null
    successMessage = null
    try {
      await adminJsonRequest(`/api/admin/matches/${matchId}/streams`, {
        method: 'DELETE',
        body: { streamId },
        fallbackMessage: 'Failed to remove stream',
      })
      successMessage = 'Stream removed.'
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to remove stream'
    }
  }

  async function addPlayerToTeam(teamId: string) {
    const state = addPlayerForm[teamId] ?? { playerName: '', role: 'player' }
    if (!state.playerName.trim()) {
      errorMessage = 'Enter a player name to add'
      return
    }

    errorMessage = null
    successMessage = null

    try {
      await adminJsonRequest('/api/admin/teams/manage', {
        method: 'POST',
        body: { teamId, playerName: state.playerName.trim(), role: state.role },
        fallbackMessage: 'Failed to add player',
      })

      successMessage = 'Player added to team.'
      updateAddPlayerForm(teamId, { playerName: '', role: 'player' })
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to add player'
    }
  }

  function requestRoleChange(
    userId: string,
    userName: string,
    currentRole: string,
    newRole: string
  ) {
    if (currentRole === newRole) return
    pendingRoleChange = { userId, userName, currentRole, newRole }
    showRoleConfirmation = true
  }

  function cancelRoleChange() {
    showRoleConfirmation = false
    pendingRoleChange = null
  }

  async function confirmRoleChange() {
    if (!pendingRoleChange) return

    isUpdatingRole = true
    errorMessage = null

    try {
      await adminJsonRequest('/api/admin/users', {
        method: 'PATCH',
        body: {
          userId: pendingRoleChange.userId,
          newRole: pendingRoleChange.newRole,
        },
        fallbackMessage: 'Failed to update role',
      })

      // Update local state
      users = users.map((u) =>
        u.id === pendingRoleChange!.userId ? { ...u, role: pendingRoleChange!.newRole } : u
      )

      successMessage = `Updated ${pendingRoleChange.userName} to ${pendingRoleChange.newRole}.`

      showRoleConfirmation = false
      pendingRoleChange = null
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to update role'
    } finally {
      isUpdatingRole = false
    }
  }

  function removeApprovedTeam(teamId: string, teamName: string) {
    pendingActionConfirmation = {
      kind: 'remove_team',
      teamId,
      teamName,
      title: 'Confirm Team Removal',
      message: `Are you sure you want to remove approved team "${teamName}"? This will deactivate roster memberships.`,
      confirmLabel: 'Remove Team',
    }
    showActionConfirmation = true
  }

  async function executeRemoveApprovedTeam(teamId: string, teamName: string) {
    processingTeamId = teamId
    errorMessage = null
    successMessage = null

    try {
      await adminJsonRequest('/api/admin/teams/manage', {
        method: 'DELETE',
        body: { teamId },
        fallbackMessage: 'Failed to remove team',
      })

      approvedTeams = approvedTeams.filter((team) => team.id !== teamId)
      successMessage = `Removed team ${teamName}.`
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to remove team'
    } finally {
      processingTeamId = null
    }
  }

  function removeApprovedTeamPlayer(
    teamId: string,
    membershipId: number | null,
    profileId: string,
    riotId: string,
    role: string
  ) {
    const label = role === 'captain' ? `${riotId} (captain)` : riotId
    pendingActionConfirmation = {
      kind: 'remove_player',
      teamId,
      membershipId,
      profileId,
      riotId,
      role,
      title: 'Confirm Player Removal',
      message: `Remove ${label} from this team? This deactivates their membership immediately.`,
      confirmLabel: 'Remove Player',
    }
    showActionConfirmation = true
  }

  async function executeRemoveApprovedTeamPlayer(
    teamId: string,
    membershipId: number | null,
    profileId: string,
    riotId: string
  ) {
    processingTeamId = teamId
    errorMessage = null
    successMessage = null

    try {
      await adminJsonRequest('/api/admin/teams/manage', {
        method: 'PATCH',
        body: { teamId, profileId: profileId || null, membershipId },
        fallbackMessage: 'Failed to remove player',
      })

      approvedTeams = approvedTeams.map((team) => {
        if (team.id !== teamId) return team
        const nextRoster = (team.roster ?? []).filter(
          (player) => player.membership_id !== membershipId
        )
        return {
          ...team,
          roster: nextRoster,
          roster_count: Math.max(0, (team.roster_count ?? 0) - 1),
        }
      })
      successMessage = `Removed ${riotId} from team.`
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to remove player'
    } finally {
      processingTeamId = null
    }
  }

  function cancelActionConfirmation() {
    showActionConfirmation = false
    pendingActionConfirmation = null
  }

  async function confirmActionConfirmation() {
    if (!pendingActionConfirmation) return

    const action = pendingActionConfirmation
    showActionConfirmation = false
    pendingActionConfirmation = null

    if (action.kind === 'remove_team') {
      await executeRemoveApprovedTeam(action.teamId, action.teamName)
      return
    }

    if (action.kind === 'finalize_match') {
      await executeFinalizeMatch(action)
      return
    }

    if (action.kind === 'cancel_match') {
      await executeCancelMatch(action.matchId)
      return
    }

    if (action.kind === 'save_team') {
      await executeSaveTeamEdits(action.teamId)
      return
    }

    if (action.kind === 'save_match') {
      await executeSaveMatchEdits(action.matchId)
      return
    }

    if (action.kind === 'delete_match') {
      await executeDeleteMatch(action.matchId)
      return
    }

    if (action.kind === 'delete_stream') {
      await executeRemoveMatchStream(action.matchId, action.streamId)
      return
    }

    if (action.kind === 'save_user_riot') {
      await executeSaveUserRiotId(action.userId, action.riotIdBase)
      return
    }

    if (action.kind === 'remove_player') {
      await executeRemoveApprovedTeamPlayer(
        action.teamId,
        action.membershipId,
        action.profileId,
        action.riotId
      )
    }
  }
</script>

<PageContainer>
  <AdminDashboardShell
    {activeTab}
    counts={{
      users: users.length,
      teams: approvedTeams.length,
      matches: matches.length,
      seasons: seasons.length,
    }}
    {isLoading}
    {errorMessage}
    {successMessage}
    onTabChange={(tab) => (activeTab = tab)}
    onRefresh={refreshData}
  >
    {#if activeTab === 'users'}
      <AdminUsersTab
        {users}
        {displayedUsers}
        {usersSearch}
        {userRiotIdForm}
        onUsersSearchChange={(value) => (usersSearch = value)}
        onUserRiotIdInput={(userId, value) =>
          (userRiotIdForm = {
            ...userRiotIdForm,
            [userId]: value,
          })}
        onRequestRoleChange={requestRoleChange}
        onRequestUserRiotIdSave={requestUserRiotIdSave}
      />
    {/if}

    {#if activeTab === 'teams'}
      <AdminTeamsTab
        {teamsSearch}
        {createTeamName}
        {createTeamTag}
        {isCreatingTeam}
        {displayedApprovedTeams}
        {addPlayerForm}
        {teamEditForm}
        {processingTeamId}
        onTeamsSearchChange={(value) => (teamsSearch = value)}
        onCreateTeamNameChange={(value) => (createTeamName = value)}
        onCreateTeamTagChange={(value) => (createTeamTag = value)}
        onCreateTeamLogoInput={(file, input) => {
          createTeamLogoFile = file
          createTeamLogoInput = input
        }}
        onCreateTeam={createTeam}
        onTeamEditChange={updateTeamEditForm}
        onTeamLogoChange={(teamId, file) =>
          (teamLogoFileById = {
            ...teamLogoFileById,
            [teamId]: file,
          })}
        onSaveTeam={saveTeamEdits}
        onAddPlayerChange={updateAddPlayerForm}
        onAddPlayer={addPlayerToTeam}
        onRemovePlayer={removeApprovedTeamPlayer}
        onRemoveTeam={removeApprovedTeam}
      />
    {/if}

    {#if activeTab === 'matches'}
      <AdminMatchesTab
        {approvedTeamOptions}
        {approvedTeams}
        {createMatchTeamAId}
        {createMatchTeamBId}
        {createMatchBestOf}
        {createMatchScheduledAt}
        {isCreatingMatch}
        {matches}
        {matchSearchQuery}
        {showCompletedAdminMatches}
        {filteredAdminMatches}
        {expandedAdminMatchId}
        {finalizeForm}
        {matchEditForm}
        {streamForm}
        {existingStreamForm}
        {vodForm}
        onCreateMatchTeamAIdChange={(value) => (createMatchTeamAId = value)}
        onCreateMatchTeamBIdChange={(value) => (createMatchTeamBId = value)}
        onCreateMatchBestOfChange={(value) => (createMatchBestOf = value as BestOfValue)}
        onCreateMatchScheduledAtChange={(value) => (createMatchScheduledAt = value)}
        onCreateMatch={createMatch}
        onMatchSearchChange={(value) => (matchSearchQuery = value)}
        onShowCompletedChange={(value) => (showCompletedAdminMatches = value)}
        onToggleExpandedMatch={(matchId) =>
          (expandedAdminMatchId = expandedAdminMatchId === matchId ? null : matchId)}
        onUpdateFinalizeForm={updateFinalizeForm}
        onFinalizeMatch={finalizeMatch}
        onCancelMatch={cancelMatch}
        onUpdateMatchEditForm={updateMatchEditForm}
        onSaveMatchEdits={saveMatchEdits}
        onDeleteMatch={deleteMatch}
        onUpdateExistingStreamForm={(streamId, patch) =>
          (existingStreamForm = {
            ...existingStreamForm,
            [streamId]: {
              ...(existingStreamForm[streamId] ?? {}),
              ...patch,
            },
          })}
        onSaveExistingMatchStream={saveExistingMatchStream}
        onRemoveMatchStream={removeMatchStream}
        onUpdateStreamForm={(matchId, patch) =>
          (streamForm = {
            ...streamForm,
            [matchId]: {
              ...(streamForm[matchId] ?? {}),
              ...patch,
            },
          })}
        onAddMatchStream={addMatchStream}
        onVodChange={(matchId, value) =>
          (vodForm = {
            ...vodForm,
            [matchId]: value,
          })}
      />
    {/if}

    {#if activeTab === 'seasons'}
      <AdminSeasonsTab
        {seasons}
        {leaderboardBatches}
        {createSeasonCode}
        {createSeasonName}
        {createSeasonStartsOn}
        {createSeasonEndsOn}
        {createSeasonIsActive}
        {isCreatingSeason}
        {seasonEditForm}
        onCreateSeasonCodeChange={(value) => (createSeasonCode = value)}
        onCreateSeasonNameChange={(value) => (createSeasonName = value)}
        onCreateSeasonStartsOnChange={(value) => (createSeasonStartsOn = value)}
        onCreateSeasonEndsOnChange={(value) => (createSeasonEndsOn = value)}
        onCreateSeasonIsActiveChange={(value) => (createSeasonIsActive = value)}
        onSeasonEditChange={(seasonId, nextState) =>
          (seasonEditForm = {
            ...seasonEditForm,
            [seasonId]: nextState,
          })}
        onCreateSeason={createSeason}
        onSaveSeason={saveSeason}
      />
    {/if}
  </AdminDashboardShell>

  <!-- Role Change Confirmation Modal -->
  {#if showRoleConfirmation && pendingRoleChange}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div
        class="w-full max-w-md rounded-lg border p-6 text-center"
        style="border-color: rgba(255, 255, 255, 0.2); background: var(--secondary-background);"
      >
        <h3 class="mb-3 text-xl font-bold" style="color: var(--title);">Confirm Role Change</h3>
        <p class="mb-5 text-sm" style="color: var(--text);">
          Are you sure you want to change <strong>{pendingRoleChange.userName}</strong>'s role from
          <span class="rounded bg-white/10 px-2 py-1 text-xs font-semibold"
            >{pendingRoleChange.currentRole}</span
          >
          to
          <span class="rounded bg-white/10 px-2 py-1 text-xs font-semibold"
            >{pendingRoleChange.newRole}</span
          >?
        </p>
        <div class="flex justify-center gap-3">
          <button
            type="button"
            class="rounded-md border px-4 py-2"
            style="border-color: rgba(255,255,255,0.2); color: var(--text);"
            onclick={cancelRoleChange}
            disabled={isUpdatingRole}
          >
            Cancel
          </button>
          <button
            type="button"
            class="rounded-md px-4 py-2 font-semibold"
            style="background: var(--accent); color: var(--text);"
            onclick={confirmRoleChange}
            disabled={isUpdatingRole}
          >
            {isUpdatingRole ? 'Updating...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <AdminActionConfirmationModal
    open={showActionConfirmation && Boolean(pendingActionConfirmation)}
    title={pendingActionConfirmation?.title ?? ''}
    message={pendingActionConfirmation?.message ?? ''}
    confirmLabel={pendingActionConfirmation?.confirmLabel ?? 'Confirm'}
    onCancel={cancelActionConfirmation}
    onConfirm={confirmActionConfirmation}
  />
</PageContainer>
