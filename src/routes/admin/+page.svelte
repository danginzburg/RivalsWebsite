<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import {
    Shield,
    RefreshCw,
    UserCog,
    ShieldCheck,
    Check,
    X,
    CalendarDays,
    CalendarCheck2,
    Upload,
  } from 'lucide-svelte'
  import { TEAM_BALANCE_RANKS } from '$lib/team-balance'

  // Get data from server load
  let { data } = $props() as { data: any }

  type TeamQueueEntry = {
    id: string
    name: string
    tag: string | null
    logo_path: string | null
    logo_url?: string | null
    metadata?: {
      initial_roster?: Array<{ riot_id?: string; rank_label?: string }>
    } | null
    approval_status: string
    approval_notes?: string | null
    roster_count?: number
    roster?: Array<{
      profile_id: string
      role: string
      riot_id_base: string | null
      display_name: string | null
      email: string | null
    }>
    profiles?: { id?: string; display_name?: string | null; email?: string | null }[] | null
    captain_profile?: { display_name?: string | null; email?: string | null } | null
  }

  let activeTab = $state<'users' | 'teams' | 'matches'>('matches')
  let isLoading = $state(false)
  let errorMessage = $state<string | null>(null)
  let successMessage = $state<string | null>(null)

  const getInitialPlayers = () => data.players || []
  const getInitialObservers = () => data.observers || []
  const getInitialUsers = () => data.users || []
  const getInitialTeamQueue = () => data.teamQueue || []
  const getInitialApprovedTeams = () => data.approvedTeams || []
  const getInitialMatches = () => data.matches || []

  let players = $state<any[]>(getInitialPlayers())
  let observers = $state<any[]>(getInitialObservers())
  let users = $state<any[]>(getInitialUsers())
  let teamQueue = $state<TeamQueueEntry[]>(getInitialTeamQueue())
  let approvedTeams = $state<TeamQueueEntry[]>(getInitialApprovedTeams())
  let matches = $state<any[]>(getInitialMatches())

  const approvedTeamOptions = $derived(
    (approvedTeams ?? []).map((t) => ({
      label: `${t.name}${t.tag ? ` [${String(t.tag).toUpperCase()}]` : ''}`,
      value: t.id,
    }))
  )

  const bestOfOptions = [
    { value: '3', label: 'BO3' },
    { value: '5', label: 'BO5' },
  ]

  let createMatchTeamAId = $state('')
  let createMatchTeamBId = $state('')
  let createMatchBestOf = $state<'3' | '5'>('3')
  let createMatchScheduledAt = $state('')
  let isCreatingMatch = $state(false)

  let createTeamName = $state('')
  let createTeamTag = $state('')
  let createTeamLogoFile = $state<File | null>(null)
  let isCreatingTeam = $state(false)

  let addPlayerForm = $state<Record<string, { profileId: string; role: string }>>({})

  function updateAddPlayerForm(
    teamId: string,
    patch: Partial<{ profileId: string; role: string }>
  ) {
    const current = addPlayerForm[teamId] ?? { profileId: '', role: 'player' }
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
    const next: Record<string, { profileId: string; role: string }> = {}
    for (const id of ids) {
      next[id] = addPlayerForm[id] ?? { profileId: '', role: 'player' }
    }
    // Preserve object identity when no changes.
    const prevKeys = Object.keys(addPlayerForm)
    const nextKeys = Object.keys(next)
    const changed =
      prevKeys.length !== nextKeys.length ||
      nextKeys.some(
        (k) =>
          !addPlayerForm[k] ||
          addPlayerForm[k].profileId !== next[k].profileId ||
          addPlayerForm[k].role !== next[k].role
      )
    if (changed) addPlayerForm = next
  })

  const membershipRoleOptions = [
    { value: 'player', label: 'Player' },
    { value: 'captain', label: 'Captain' },
    { value: 'substitute', label: 'Sub' },
    { value: 'coach', label: 'Coach' },
  ]

  const playerOptions = $derived.by(() => {
    return (users ?? [])
      .filter((u) => u.role !== 'banned' && u.role !== 'restricted')
      .map((u) => {
        const labelParts = [u.riot_id_base || u.display_name || u.email || u.id]
        if (u.riot_id_base && u.display_name && u.display_name !== u.riot_id_base) {
          labelParts.push(u.display_name)
        }
        return { value: u.id, label: labelParts.filter(Boolean).join(' - ') }
      })
  })

  let finalizeForm = $state<
    Record<string, { teamAScore: string; teamBScore: string; winnerTeamId: string }>
  >({})

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

  function teamName(value: unknown) {
    if (!value) return 'Team'
    if (Array.isArray(value)) {
      const first = value[0] as { name?: string } | undefined
      return first?.name ?? 'Team'
    }
    const team = value as { name?: string }
    return team.name ?? 'Team'
  }

  function formatUtc(value: string | null | undefined) {
    if (!value) return 'No date'
    const date = new Date(value)
    return `${date.toLocaleString(undefined, { timeZone: 'UTC' })} UTC`
  }

  // Role change confirmation
  let showRoleConfirmation = $state(false)
  let pendingRoleChange = $state<{
    userId: string
    userName: string
    currentRole: string
    newRole: string
  } | null>(null)
  let isUpdatingRole = $state(false)
  let showRankConfirmation = $state(false)
  let showUnrankedOnly = $state(false)
  let playersSearch = $state('')
  let observersSearch = $state('')
  let usersSearch = $state('')
  let teamsSearch = $state('')
  let pendingRankChange = $state<{
    registrationId: number
    riotId: string
    currentRank: string
    newRank: string
  } | null>(null)
  let processingTeamId = $state<string | null>(null)
  let processingRankRegistrationId = $state<number | null>(null)
  let showTeamModerationConfirmation = $state(false)
  let pendingTeamModeration = $state<{
    teamId: string
    action: 'approve' | 'reject'
    notes: string
    name: string
    tag: string
    logoPath: string
  } | null>(null)
  let showActionConfirmation = $state(false)
  let pendingActionConfirmation = $state<
    | {
        kind: 'remove_logo'
        teamId: string
        path: string
        title: string
        message: string
        confirmLabel: string
      }
    | {
        kind: 'remove_team'
        teamId: string
        teamName: string
        title: string
        message: string
        confirmLabel: string
      }
    | {
        kind: 'remove_player'
        teamId: string
        profileId: string
        riotId: string
        role: string
        title: string
        message: string
        confirmLabel: string
      }
    | {
        kind: 'purge_user'
        profileId: string
        label: string
        title: string
        message: string
        confirmLabel: string
      }
    | null
  >(null)

  const rankOptions = TEAM_BALANCE_RANKS.map((rank) => rank.name)
  const rankSelectOptions = [
    { value: '', label: 'Select rank' },
    ...rankOptions.map((r) => ({ value: r, label: r })),
  ]
  const roleSelectOptions = [
    { value: 'user', label: 'User' },
    { value: 'restricted', label: 'Restricted' },
    { value: 'banned', label: 'Banned' },
    { value: 'admin', label: 'Admin' },
  ]
  function normalizeSearchValue(value: string): string {
    return value.trim().toLowerCase()
  }

  const displayedPlayers = $derived.by(() => {
    const search = normalizeSearchValue(playersSearch)
    return players.filter((player) => {
      if (showUnrankedOnly && player.rank_label) return false
      if (!search) return true
      const haystack =
        `${player.riot_id ?? ''} ${profileLabel(player.profiles)} ${player.pronouns ?? ''}`.toLowerCase()
      return haystack.includes(search)
    })
  })

  const displayedObservers = $derived.by(() => {
    const search = normalizeSearchValue(observersSearch)
    return observers.filter((observer) => {
      if (!search) return true
      const haystack =
        `${profileLabel(observer.profiles)} ${observer.additional_info ?? ''}`.toLowerCase()
      return haystack.includes(search)
    })
  })

  const displayedUsers = $derived.by(() => {
    const search = normalizeSearchValue(usersSearch)
    return users.filter((user) => {
      if (!search) return true
      const haystack =
        `${user.display_name ?? ''} ${user.email ?? ''} ${user.role ?? ''}`.toLowerCase()
      return haystack.includes(search)
    })
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

  function profileLabel(profileRel: unknown): string {
    if (!profileRel) return '—'

    if (Array.isArray(profileRel)) {
      const first = profileRel[0] as
        | { display_name?: string | null; email?: string | null }
        | undefined
      return first?.display_name || first?.email || '—'
    }

    const single = profileRel as { display_name?: string | null; email?: string | null }
    return single.display_name || single.email || '—'
  }

  async function refreshData() {
    isLoading = true
    errorMessage = null
    successMessage = null

    try {
      const [usersResponse, teamsResponse, matchesResponse] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/teams'),
        fetch('/api/admin/matches'),
      ])

      if (!usersResponse.ok) {
        const err = await usersResponse.json()
        throw new Error(err.message || 'Failed to fetch users')
      }
      if (!teamsResponse.ok) {
        const err = await teamsResponse.json()
        throw new Error(err.message || 'Failed to fetch teams')
      }
      if (!matchesResponse.ok) {
        const err = await matchesResponse.json()
        throw new Error(err.message || 'Failed to fetch matches')
      }

      const usersResult = await usersResponse.json()
      const teamsResult = await teamsResponse.json()
      const matchesResult = await matchesResponse.json()

      users = usersResult.users
      teamQueue = teamsResult.queue
      approvedTeams = teamsResult.approved
      matches = matchesResult.matches
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
    const confirmed = window.confirm(
      'Are you sure you want to finalize this match? This is official.'
    )
    if (!confirmed) return

    errorMessage = null
    successMessage = null

    try {
      const response = await fetch(`/api/admin/matches/${match.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'finalize',
          winnerTeamId: state.winnerTeamId,
          teamAScore: Number(state.teamAScore),
          teamBScore: Number(state.teamBScore),
        }),
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Failed to finalize match')
      successMessage = 'Match finalized.'
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to finalize match'
    }
  }

  async function cancelMatch(match: any) {
    const confirmed = window.confirm('Are you sure you want to cancel this match?')
    if (!confirmed) return

    errorMessage = null
    successMessage = null

    try {
      const response = await fetch(`/api/admin/matches/${match.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Failed to cancel match')
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
      const response = await fetch('/api/admin/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamAId: createMatchTeamAId,
          teamBId: createMatchTeamBId,
          bestOf: Number(createMatchBestOf),
          scheduledAt: createMatchScheduledAt || null,
        }),
      })

      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Failed to create match')

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

      const response = await fetch('/api/admin/teams', {
        method: 'POST',
        body: form,
      })

      const result = await response.json().catch(async () => {
        const text = await response.text().catch(() => '')
        return { message: text }
      })
      if (!response.ok) {
        throw new Error(result.message || `Failed to create team (HTTP ${response.status})`)
      }

      successMessage = 'Team created.'
      createTeamName = ''
      createTeamTag = ''
      createTeamLogoFile = null
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to create team'
    } finally {
      isCreatingTeam = false
    }
  }

  async function addPlayerToTeam(teamId: string) {
    const state = addPlayerForm[teamId] ?? { profileId: '', role: 'player' }
    if (!state.profileId) {
      errorMessage = 'Select a player to add'
      return
    }

    errorMessage = null
    successMessage = null

    try {
      const res = await fetch('/api/admin/teams/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, profileId: state.profileId, role: state.role }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.message ?? 'Failed to add player')

      successMessage = 'Player added to team.'
      updateAddPlayerForm(teamId, { profileId: '', role: 'player' })
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to add player'
    }
  }

  function rankSelectStyle(rank: string | null | undefined): string {
    if (rank) {
      return 'border-color: rgba(74,222,128,0.45); background: rgba(22,163,74,0.12); color: var(--text);'
    }
    return 'border-color: rgba(250,204,21,0.45); background: rgba(234,179,8,0.12); color: var(--text);'
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
      const response = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: pendingRoleChange.userId,
          newRole: pendingRoleChange.newRole,
        }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.message || 'Failed to update role')
      }

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

  function requestPurgeUserFromLists(profileId: string, label: string) {
    pendingActionConfirmation = {
      kind: 'purge_user',
      profileId,
      label,
      title: 'Confirm Removal From Lists',
      message:
        `Remove ${label} from all participation lists? ` +
        `This deletes their player registration, observer application, team memberships (removes them from teams), and any team invites. ` +
        `This does not delete the account profile.`,
      confirmLabel: 'Remove From Lists',
    }
    showActionConfirmation = true
  }

  async function executePurgeUserFromLists(profileId: string) {
    errorMessage = null
    successMessage = null
    isLoading = true

    try {
      const response = await fetch('/api/admin/users/purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: profileId }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Failed to purge user')

      successMessage = 'User removed from participation lists.'
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to purge user'
    } finally {
      isLoading = false
    }
  }

  async function moderateTeam(
    teamId: string,
    action: 'approve' | 'reject',
    notes: string,
    name: string,
    tag: string,
    logoPath: string
  ) {
    processingTeamId = teamId
    errorMessage = null

    try {
      const response = await fetch('/api/admin/teams', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId,
          action,
          notes,
          name,
          tag,
          logoPath,
        }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.message || 'Failed to moderate team')
      }

      teamQueue = teamQueue.filter((entry) => entry.id !== teamId)
      await refreshData()
      successMessage = action === 'approve' ? `Approved team ${name}.` : `Rejected team ${name}.`
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to moderate team'
    } finally {
      processingTeamId = null
    }
  }

  function requestTeamModeration(
    teamId: string,
    action: 'approve' | 'reject',
    notes: string,
    name: string,
    tag: string,
    logoPath: string
  ) {
    pendingTeamModeration = { teamId, action, notes, name, tag, logoPath }
    showTeamModerationConfirmation = true
  }

  function cancelTeamModeration() {
    showTeamModerationConfirmation = false
    pendingTeamModeration = null
  }

  async function confirmTeamModeration() {
    if (!pendingTeamModeration) return
    await moderateTeam(
      pendingTeamModeration.teamId,
      pendingTeamModeration.action,
      pendingTeamModeration.notes,
      pendingTeamModeration.name,
      pendingTeamModeration.tag,
      pendingTeamModeration.logoPath
    )
    showTeamModerationConfirmation = false
    pendingTeamModeration = null
  }

  function removeTeamLogo(teamId: string, path: string) {
    pendingActionConfirmation = {
      kind: 'remove_logo',
      teamId,
      path,
      title: 'Confirm Logo Removal',
      message: 'Are you sure you want to remove this team logo?',
      confirmLabel: 'Remove Logo',
    }
    showActionConfirmation = true
  }

  async function executeRemoveTeamLogo(teamId: string, path: string) {
    processingTeamId = teamId
    errorMessage = null
    successMessage = null

    try {
      const response = await fetch('/api/admin/teams/logo', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.message || 'Failed to remove logo')
      }

      teamQueue = teamQueue.map((entry) =>
        entry.id === teamId ? { ...entry, logo_path: null } : entry
      )
      successMessage = 'Team logo removed.'
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to remove logo'
    } finally {
      processingTeamId = null
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
      const response = await fetch('/api/admin/teams/manage', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.message || 'Failed to remove team')
      }

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
    profileId: string,
    riotId: string,
    role: string
  ) {
    const label = role === 'captain' ? `${riotId} (captain)` : riotId
    pendingActionConfirmation = {
      kind: 'remove_player',
      teamId,
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
    profileId: string,
    riotId: string
  ) {
    processingTeamId = teamId
    errorMessage = null
    successMessage = null

    try {
      const response = await fetch('/api/admin/teams/manage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, profileId }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.message || 'Failed to remove player')
      }

      approvedTeams = approvedTeams.map((team) => {
        if (team.id !== teamId) return team
        const nextRoster = (team.roster ?? []).filter((player) => player.profile_id !== profileId)
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

    if (action.kind === 'remove_logo') {
      await executeRemoveTeamLogo(action.teamId, action.path)
      return
    }

    if (action.kind === 'remove_team') {
      await executeRemoveApprovedTeam(action.teamId, action.teamName)
      return
    }

    if (action.kind === 'purge_user') {
      await executePurgeUserFromLists(action.profileId)
      return
    }

    await executeRemoveApprovedTeamPlayer(action.teamId, action.profileId, action.riotId)
  }

  async function updatePlayerRank(registrationId: number, rankLabel: string) {
    processingRankRegistrationId = registrationId
    errorMessage = null
    try {
      const response = await fetch('/api/admin/player-ranks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationId, rankLabel }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.message || 'Failed to update player rank')
      }

      players = players.map((player) =>
        player.id === registrationId
          ? {
              ...player,
              rank_label: result.player.rank_label,
              rank_value: result.player.rank_value,
            }
          : player
      )
      successMessage = `Updated rank to ${result.player.rank_label}.`
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to update player rank'
    } finally {
      processingRankRegistrationId = null
    }
  }

  function requestRankChange(
    registrationId: number,
    riotId: string,
    currentRank: string,
    newRank: string
  ) {
    if (!newRank || currentRank === newRank) return
    pendingRankChange = {
      registrationId,
      riotId,
      currentRank: currentRank || 'Unassigned',
      newRank,
    }
    showRankConfirmation = true
  }

  function cancelRankChange() {
    showRankConfirmation = false
    pendingRankChange = null
  }

  async function confirmRankChange() {
    if (!pendingRankChange) return
    await updatePlayerRank(pendingRankChange.registrationId, pendingRankChange.newRank)
    showRankConfirmation = false
    pendingRankChange = null
  }
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-6xl">
      <div class="mb-4 flex justify-end">
        <a
          href="/admin/stats-import"
          class="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold"
          style="background: rgba(59,130,246,0.2); color: #93c5fd;"
        >
          <Upload size={16} />
          Stats Import
        </a>
      </div>
      <div class="mb-8 flex flex-col items-center">
        <Shield size={48} style="color: var(--text);" class="mb-4" />
        <h1 class="responsive-title mb-2 text-center">Admin Dashboard</h1>
        <p class="responsive-text text-center" style="color: var(--text);">
          Manage everything from one place
        </p>
      </div>

      <div class="info-card info-card-surface p-0">
        <div class="flex border-b" style="border-color: rgba(255, 255, 255, 0.12);">
          <button
            type="button"
            class="flex items-center gap-2 border-b-2 px-3 py-3 text-sm sm:px-5 sm:text-base"
            style={activeTab === 'users'
              ? 'border-color: var(--accent); color: var(--text); background: rgba(255, 255, 255, 0.05);'
              : 'border-color: transparent; color: rgba(255,255,255,0.7);'}
            onclick={() => (activeTab = 'users')}
          >
            <UserCog size={18} />
            <span>Users ({users.length})</span>
          </button>
          <button
            type="button"
            class="flex items-center gap-2 border-b-2 px-3 py-3 text-sm sm:px-5 sm:text-base"
            style={activeTab === 'teams'
              ? 'border-color: var(--accent); color: var(--text); background: rgba(255, 255, 255, 0.05);'
              : 'border-color: transparent; color: rgba(255,255,255,0.7);'}
            onclick={() => (activeTab = 'teams')}
          >
            <ShieldCheck size={18} />
            <span>Teams ({approvedTeams.length})</span>
          </button>
          <button
            type="button"
            class="flex items-center gap-2 border-b-2 px-3 py-3 text-sm sm:px-5 sm:text-base"
            style={activeTab === 'matches'
              ? 'border-color: var(--accent); color: var(--text); background: rgba(255, 255, 255, 0.05);'
              : 'border-color: transparent; color: rgba(255,255,255,0.7);'}
            onclick={() => (activeTab = 'matches')}
          >
            <CalendarDays size={18} />
            <span>Matches ({matches.length})</span>
          </button>
          <button
            type="button"
            class="ml-auto px-3 py-3 text-sm sm:px-4"
            style="color: var(--text);"
            onclick={refreshData}
            disabled={isLoading}
            title="Refresh data"
          >
            <RefreshCw size={18} class={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        {#if errorMessage}
          <div
            class="px-4 py-3 text-sm"
            style="color: #f87171; background: rgba(248, 113, 113, 0.15);"
          >
            {errorMessage}
          </div>
        {/if}
        {#if successMessage}
          <div
            class="px-4 py-3 text-sm"
            style="color: #4ade80; background: rgba(74, 222, 128, 0.15);"
          >
            {successMessage}
          </div>
        {/if}

        <div class="p-3 sm:p-4">
          {#if activeTab === 'users'}
            {#if users.length === 0}
              <div class="py-10 text-center" style="color: rgba(255,255,255,0.72);">
                No users found.
              </div>
            {:else}
              <input
                bind:value={usersSearch}
                placeholder="Search users by Discord, email, role"
                class="mb-3 w-full rounded-md border px-3 py-2 text-sm"
                style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
              />
              <div class="space-y-3 md:hidden">
                {#each displayedUsers as user}
                  <article
                    class="rounded-lg border p-3"
                    style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
                  >
                    <div class="mb-2 font-semibold" style="color: var(--title);">
                      {user.display_name || '—'}
                    </div>
                    <div class="w-40">
                      <CustomSelect
                        options={roleSelectOptions}
                        value={user.role}
                        placeholder="Select role"
                        onSelect={(value) =>
                          requestRoleChange(user.id, user.display_name || '—', user.role, value)}
                      />
                    </div>

                    <div class="mt-3 flex gap-2">
                      <button
                        type="button"
                        class="rounded px-2 py-1 text-xs"
                        style="background: rgba(248,113,113,0.2); color: #f87171;"
                        onclick={() =>
                          requestPurgeUserFromLists(
                            user.id,
                            user.display_name || user.email || 'user'
                          )}
                      >
                        Remove From Lists
                      </button>
                    </div>
                  </article>
                {/each}
              </div>

              <div class="hidden overflow-x-auto md:block">
                <table class="w-full text-left text-sm">
                  <thead>
                    <tr class="text-xs tracking-wide uppercase opacity-70">
                      <th class="px-3 py-2">Discord</th>
                      <th class="px-3 py-2">Role</th>
                      <th class="px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each displayedUsers as user}
                      <tr class="border-t" style="border-color: rgba(255,255,255,0.1);">
                        <td class="px-3 py-2 font-semibold">{user.display_name || '—'}</td>
                        <td class="px-3 py-2">
                          <div class="w-40">
                            <CustomSelect
                              options={roleSelectOptions}
                              value={user.role}
                              placeholder="Select role"
                              onSelect={(value) =>
                                requestRoleChange(
                                  user.id,
                                  user.display_name || '—',
                                  user.role,
                                  value
                                )}
                            />
                          </div>
                        </td>
                        <td class="px-3 py-2">
                          <button
                            type="button"
                            class="rounded px-2 py-1 text-xs"
                            style="background: rgba(248,113,113,0.2); color: #f87171;"
                            onclick={() =>
                              requestPurgeUserFromLists(
                                user.id,
                                user.display_name || user.email || 'user'
                              )}
                          >
                            Remove From Lists
                          </button>
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          {/if}

          {#if activeTab === 'teams'}
            <input
              bind:value={teamsSearch}
              placeholder="Search teams by name, tag, captain"
              class="mb-3 w-full rounded-md border px-3 py-2 text-sm"
              style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
            />

            <div class="mb-6 rounded-md border p-3" style="border-color: rgba(255,255,255,0.12);">
              <h3
                class="mb-3 text-sm font-semibold tracking-wide uppercase"
                style="color: rgba(255,255,255,0.8);"
              >
                Create Team
              </h3>

              <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label class="flex flex-col gap-1 text-sm" style="color: var(--text);">
                  Team Name
                  <input
                    bind:value={createTeamName}
                    required
                    minlength="2"
                    maxlength="48"
                    class="rounded-md border px-3 py-2"
                    style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                    placeholder="Team name"
                  />
                </label>
                <label class="flex flex-col gap-1 text-sm" style="color: var(--text);">
                  Tag (optional)
                  <input
                    bind:value={createTeamTag}
                    maxlength="4"
                    minlength="2"
                    class="rounded-md border px-3 py-2"
                    style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                    placeholder="TCR"
                  />
                </label>
                <label class="flex flex-col gap-1 text-sm" style="color: var(--text);">
                  Logo (optional)
                  <input
                    type="file"
                    accept="image/*"
                    class="rounded-md border px-3 py-2 text-sm"
                    style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                    oninput={(e) => {
                      const f = (e.currentTarget as HTMLInputElement).files?.[0] ?? null
                      createTeamLogoFile = f
                    }}
                  />
                </label>
              </div>

              <div class="mt-3 flex justify-end">
                <button
                  type="button"
                  class="rounded-md px-3 py-2 text-xs font-semibold"
                  style="background: rgba(74,222,128,0.2); color: #4ade80;"
                  onclick={createTeam}
                  disabled={isCreatingTeam}
                >
                  {isCreatingTeam ? 'Creating...' : 'Create Team'}
                </button>
              </div>
            </div>

            <div class="rounded-md border p-3" style="border-color: rgba(255,255,255,0.12);">
              <h3
                class="mb-3 text-sm font-semibold tracking-wide uppercase"
                style="color: rgba(255,255,255,0.8);"
              >
                Approved Teams ({displayedApprovedTeams.length})
              </h3>
              {#if displayedApprovedTeams.length === 0}
                <div class="py-6 text-center text-sm" style="color: rgba(255,255,255,0.72);">
                  No approved teams yet.
                </div>
              {:else}
                <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {#each displayedApprovedTeams as team}
                    {@const addState = addPlayerForm[team.id] ?? { profileId: '', role: 'player' }}
                    <article
                      class="rounded-lg border p-3"
                      style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
                    >
                      <div class="mb-2 flex items-center gap-3">
                        {#if team.logo_url}
                          <img
                            src={team.logo_url}
                            alt="Team logo"
                            class="h-10 w-10 rounded object-contain"
                          />
                        {:else}
                          <div
                            class="flex h-10 w-10 items-center justify-center rounded bg-white/10 text-xs"
                          >
                            N/A
                          </div>
                        {/if}
                        <div class="min-w-0">
                          <div class="truncate text-sm font-semibold" style="color: var(--text);">
                            {team.name}
                            {#if team.tag}
                              <span class="opacity-80"> [{team.tag}]</span>
                            {/if}
                          </div>
                          <div class="text-xs" style="color: rgba(255,255,255,0.72);">
                            Roster: {team.roster_count ?? 0}
                          </div>
                        </div>
                      </div>

                      <div class="space-y-1 text-xs" style="color: rgba(255,255,255,0.8);">
                        <div>Captain: {profileLabel(team.captain_profile)}</div>
                      </div>

                      {#if (team.roster ?? []).length > 0}
                        <div
                          class="mt-3 rounded-md border p-2"
                          style="border-color: rgba(255,255,255,0.12);"
                        >
                          <div
                            class="mb-2 text-[11px] font-semibold tracking-wide uppercase"
                            style="color: rgba(255,255,255,0.7);"
                          >
                            Team Players
                          </div>
                          <div class="flex flex-col gap-1">
                            {#each team.roster ?? [] as player}
                              <div
                                class="flex items-center justify-between gap-2 rounded px-2 py-1"
                                style="background: rgba(255,255,255,0.05);"
                              >
                                <div class="min-w-0 text-xs" style="color: var(--text);">
                                  <span class="font-semibold"
                                    >{player.riot_id_base ??
                                      player.display_name ??
                                      player.email ??
                                      'User'}</span
                                  >
                                  <span class="opacity-75"> - {profileLabel(player)}</span>
                                  {#if player.role === 'captain'}
                                    <span
                                      class="ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase"
                                      style="background: rgba(250,204,21,0.2); color: #fde68a;"
                                    >
                                      Captain
                                    </span>
                                  {/if}
                                </div>
                                <button
                                  type="button"
                                  class="rounded px-2 py-1 text-[11px] font-semibold"
                                  style="background: rgba(248,113,113,0.2); color: #f87171;"
                                  disabled={processingTeamId === team.id}
                                  onclick={() =>
                                    removeApprovedTeamPlayer(
                                      team.id,
                                      player.profile_id,
                                      player.riot_id_base ??
                                        player.display_name ??
                                        player.email ??
                                        'User',
                                      player.role
                                    )}
                                >
                                  Remove
                                </button>
                              </div>
                            {/each}
                          </div>
                        </div>
                      {/if}

                      <div
                        class="mt-3 rounded-md border p-2"
                        style="border-color: rgba(255,255,255,0.12);"
                      >
                        <div
                          class="mb-2 text-[11px] font-semibold tracking-wide uppercase"
                          style="color: rgba(255,255,255,0.7);"
                        >
                          Add Player
                        </div>

                        <div class="grid grid-cols-1 gap-2 md:grid-cols-3">
                          <div class="md:col-span-2">
                            <CustomSelect
                              options={playerOptions}
                              value={addState.profileId}
                              placeholder={'Select player'}
                              compact={true}
                              disabled={false}
                              onSelect={(value) =>
                                updateAddPlayerForm(team.id, { profileId: value })}
                            />
                          </div>
                          <div>
                            <CustomSelect
                              options={membershipRoleOptions}
                              value={addState.role}
                              placeholder="Role"
                              compact={true}
                              onSelect={(value) => updateAddPlayerForm(team.id, { role: value })}
                            />
                          </div>
                        </div>

                        <div class="mt-2 flex justify-end">
                          <button
                            type="button"
                            class="rounded px-2 py-1 text-xs font-semibold"
                            style="background: rgba(74,222,128,0.2); color: #4ade80;"
                            onclick={() => addPlayerToTeam(team.id)}
                            disabled={false}
                          >
                            Add
                          </button>
                        </div>
                      </div>

                      <div class="mt-3 flex justify-end gap-2">
                        <button
                          type="button"
                          class="rounded-md px-3 py-2 text-xs font-semibold"
                          style="background: rgba(248,113,113,0.2); color: #f87171;"
                          disabled={processingTeamId === team.id}
                          onclick={() => removeApprovedTeam(team.id, team.name)}
                        >
                          Remove Team
                        </button>
                        <a
                          href={`/teams/${team.id}`}
                          class="rounded-md px-3 py-2 text-xs font-semibold"
                          style="background: rgba(59,130,246,0.2); color: #93c5fd;"
                        >
                          Open Team Page
                        </a>
                      </div>
                    </article>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}

          {#if activeTab === 'matches'}
            <div class="grid grid-cols-1 gap-4">
              <section class="rounded-md border p-3" style="border-color: rgba(255,255,255,0.12);">
                <div class="mb-3 flex items-center gap-2">
                  <CalendarCheck2 size={18} />
                  <h3
                    class="text-sm font-semibold tracking-wide uppercase"
                    style="color: rgba(255,255,255,0.8);"
                  >
                    Create Match
                  </h3>
                </div>

                <div class="grid grid-cols-1 gap-2 md:grid-cols-5">
                  <div class="md:col-span-2">
                    <CustomSelect
                      options={approvedTeamOptions}
                      value={createMatchTeamAId}
                      placeholder="Team A"
                      compact={true}
                      disabled={isCreatingMatch}
                      onSelect={(value) => (createMatchTeamAId = value)}
                    />
                  </div>
                  <div class="md:col-span-2">
                    <CustomSelect
                      options={approvedTeamOptions}
                      value={createMatchTeamBId}
                      placeholder="Team B"
                      compact={true}
                      disabled={isCreatingMatch}
                      onSelect={(value) => (createMatchTeamBId = value)}
                    />
                  </div>
                  <div>
                    <CustomSelect
                      options={bestOfOptions}
                      value={createMatchBestOf}
                      placeholder="BO3"
                      compact={true}
                      disabled={isCreatingMatch}
                      onSelect={(value) => (createMatchBestOf = value as any)}
                    />
                  </div>
                </div>

                <div class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-5">
                  <div class="md:col-span-4">
                    <input
                      type="datetime-local"
                      bind:value={createMatchScheduledAt}
                      class="w-full rounded-md border px-3 py-2 text-sm"
                      style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                      placeholder="Scheduled (UTC)"
                      disabled={isCreatingMatch}
                      aria-label="Scheduled at (UTC)"
                    />
                    <div class="mt-1 text-xs" style="color: rgba(255,255,255,0.65);">
                      Optional. Interpreted as UTC.
                    </div>
                  </div>
                  <div class="md:col-span-1">
                    <button
                      type="button"
                      class="w-full rounded-md px-3 py-2 text-sm font-semibold"
                      style="background: rgba(74,222,128,0.2); color: #4ade80;"
                      onclick={createMatch}
                      disabled={isCreatingMatch}
                    >
                      {isCreatingMatch ? 'Creating...' : 'Create'}
                    </button>
                  </div>
                </div>
              </section>

              <section class="rounded-md border p-3" style="border-color: rgba(255,255,255,0.12);">
                <div class="mb-3 flex items-center gap-2">
                  <CalendarCheck2 size={18} />
                  <h3
                    class="text-sm font-semibold tracking-wide uppercase"
                    style="color: rgba(255,255,255,0.8);"
                  >
                    Matches ({matches.length})
                  </h3>
                </div>

                {#if matches.length === 0}
                  <p class="text-sm" style="color: rgba(255,255,255,0.72);">No matches found.</p>
                {:else}
                  <div class="flex flex-col gap-2">
                    {#each matches as match}
                      {@const state = finalizeForm[match.id] ?? {
                        teamAScore: String(match.team_a_score ?? 0),
                        teamBScore: String(match.team_b_score ?? 0),
                        winnerTeamId: match.winner_team_id ?? match.team_a_id,
                      }}
                      <article
                        class="rounded-md border p-3"
                        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
                      >
                        <div class="flex flex-wrap items-center justify-between gap-2">
                          <div class="text-sm" style="color: var(--text);">
                            <strong>{teamName(match.team_a)}</strong> vs
                            <strong>{teamName(match.team_b)}</strong>
                          </div>
                          <span
                            class="rounded-full px-2 py-1 text-xs font-bold"
                            style="background: rgba(255,255,255,0.12); color: var(--text);"
                          >
                            {match.status}
                          </span>
                        </div>

                        <div class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
                          <input
                            type="number"
                            min="0"
                            value={state.teamAScore}
                            class="rounded-md border px-2 py-1"
                            style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                            placeholder="Team A score"
                            oninput={(e) =>
                              updateFinalizeForm(match.id, {
                                teamAScore: (e.currentTarget as HTMLInputElement).value,
                              })}
                          />
                          <input
                            type="number"
                            min="0"
                            value={state.teamBScore}
                            class="rounded-md border px-2 py-1"
                            style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                            placeholder="Team B score"
                            oninput={(e) =>
                              updateFinalizeForm(match.id, {
                                teamBScore: (e.currentTarget as HTMLInputElement).value,
                              })}
                          />
                          <select
                            value={state.winnerTeamId}
                            class="rounded-md border px-2 py-1"
                            style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                            onchange={(e) =>
                              updateFinalizeForm(match.id, {
                                winnerTeamId: (e.currentTarget as HTMLSelectElement).value,
                              })}
                          >
                            <option value={match.team_a_id}>{teamName(match.team_a)}</option>
                            <option value={match.team_b_id}>{teamName(match.team_b)}</option>
                          </select>
                          <div class="flex gap-2">
                            <button
                              type="button"
                              class="rounded px-2 py-1 text-xs"
                              style="background: rgba(74,222,128,0.2); color: #4ade80;"
                              onclick={() => finalizeMatch(match)}
                            >
                              Finalize
                            </button>
                            <button
                              type="button"
                              class="rounded px-2 py-1 text-xs"
                              style="background: rgba(248,113,113,0.2); color: #f87171;"
                              onclick={() => cancelMatch(match)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>

                        <div class="mt-2 flex flex-wrap gap-2">
                          <a
                            href={`/matches/${match.id}`}
                            class="rounded px-2 py-1 text-xs font-semibold"
                            style="background: rgba(255,255,255,0.10); color: rgba(255,255,255,0.85);"
                          >
                            Open Match Page
                          </a>
                          <a
                            href={`/admin/matches/${match.id}/stats-import`}
                            class="rounded px-2 py-1 text-xs font-semibold"
                            style="background: rgba(59,130,246,0.2); color: #93c5fd;"
                          >
                            Import Map Stats
                          </a>
                        </div>
                      </article>
                    {/each}
                  </div>
                {/if}
              </section>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>

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

  {#if showRankConfirmation && pendingRankChange}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div
        class="w-full max-w-md rounded-lg border p-6 text-center"
        style="border-color: rgba(255, 255, 255, 0.2); background: var(--secondary-background);"
      >
        <h3 class="mb-3 text-xl font-bold" style="color: var(--title);">Confirm Rank Change</h3>
        <p class="mb-5 text-sm" style="color: var(--text);">
          Change <strong>{pendingRankChange.riotId}</strong> from
          <span class="rounded bg-white/10 px-2 py-1 text-xs font-semibold"
            >{pendingRankChange.currentRank}</span
          >
          to
          <span class="rounded bg-white/10 px-2 py-1 text-xs font-semibold"
            >{pendingRankChange.newRank}</span
          >?
        </p>
        <div class="flex justify-center gap-3">
          <button
            type="button"
            class="rounded-md border px-4 py-2"
            style="border-color: rgba(255,255,255,0.2); color: var(--text);"
            onclick={cancelRankChange}
            disabled={processingRankRegistrationId === pendingRankChange.registrationId}
          >
            Cancel
          </button>
          <button
            type="button"
            class="rounded-md px-4 py-2 font-semibold"
            style="background: var(--accent); color: var(--text);"
            onclick={confirmRankChange}
            disabled={processingRankRegistrationId === pendingRankChange.registrationId}
          >
            {processingRankRegistrationId === pendingRankChange.registrationId
              ? 'Updating...'
              : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if showTeamModerationConfirmation && pendingTeamModeration}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div
        class="w-full max-w-md rounded-lg border p-6 text-center"
        style="border-color: rgba(255, 255, 255, 0.2); background: var(--secondary-background);"
      >
        <h3 class="mb-3 text-xl font-bold" style="color: var(--title);">Confirm Team Moderation</h3>
        <p class="mb-5 text-sm" style="color: var(--text);">
          Are you sure you want to
          <strong>{pendingTeamModeration.action === 'approve' ? 'approve' : 'reject'}</strong>
          <strong>{pendingTeamModeration.name}</strong>?
        </p>
        <div class="flex justify-center gap-3">
          <button
            type="button"
            class="rounded-md border px-4 py-2"
            style="border-color: rgba(255,255,255,0.2); color: var(--text);"
            onclick={cancelTeamModeration}
            disabled={processingTeamId === pendingTeamModeration.teamId}
          >
            Cancel
          </button>
          <button
            type="button"
            class="rounded-md px-4 py-2 font-semibold"
            style="background: var(--accent); color: var(--text);"
            onclick={confirmTeamModeration}
            disabled={processingTeamId === pendingTeamModeration.teamId}
          >
            {processingTeamId === pendingTeamModeration.teamId ? 'Applying...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if showActionConfirmation && pendingActionConfirmation}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div
        class="w-full max-w-md rounded-lg border p-6 text-center"
        style="border-color: rgba(255, 255, 255, 0.2); background: var(--secondary-background);"
      >
        <h3 class="mb-3 text-xl font-bold" style="color: var(--title);">
          {pendingActionConfirmation.title}
        </h3>
        <p class="mb-5 text-sm" style="color: var(--text);">
          {pendingActionConfirmation.message}
        </p>
        <div class="flex justify-center gap-3">
          <button
            type="button"
            class="rounded-md border px-4 py-2"
            style="border-color: rgba(255,255,255,0.2); color: var(--text);"
            onclick={cancelActionConfirmation}
          >
            Cancel
          </button>
          <button
            type="button"
            class="rounded-md px-4 py-2 font-semibold"
            style="background: var(--accent); color: var(--text);"
            onclick={confirmActionConfirmation}
          >
            {pendingActionConfirmation.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  {/if}
</PageContainer>
