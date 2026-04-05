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
    Layers3,
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
      org?: string | null
      about?: string | null
      match_import_names?: string[]
      leaderboard_import_tags?: string[]
    } | null
    approval_status: string
    approval_notes?: string | null
    roster_count?: number
    roster?: Array<{
      membership_id?: number | null
      profile_id: string
      player_name?: string | null
      role: string
      riot_id_base: string | null
      display_name: string | null
      email: string | null
    }>
    profiles?: { id?: string; display_name?: string | null; email?: string | null }[] | null
    captain_profile?: { display_name?: string | null; email?: string | null } | null
  }

  let activeTab = $state<'users' | 'teams' | 'matches' | 'seasons'>('matches')
  let isLoading = $state(false)
  let errorMessage = $state<string | null>(null)
  let successMessage = $state<string | null>(null)

  const getInitialPlayers = () => data.players || []
  const getInitialObservers = () => data.observers || []
  const getInitialUsers = () => data.users || []
  const getInitialSeasons = () => data.seasons || []
  const getInitialTeamQueue = () => data.teamQueue || []
  const getInitialApprovedTeams = () => data.approvedTeams || []
  const getInitialMatches = () => data.matches || []

  let players = $state<any[]>(getInitialPlayers())
  let observers = $state<any[]>(getInitialObservers())
  let users = $state<any[]>(getInitialUsers())
  let seasons = $state<any[]>(getInitialSeasons())
  let teamQueue = $state<TeamQueueEntry[]>(getInitialTeamQueue())
  let approvedTeams = $state<TeamQueueEntry[]>(getInitialApprovedTeams())
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
  let expandedAdminMatchId = $state<string | null>(null)

  const filteredAdminMatches = $derived.by(() => {
    const query = matchSearchQuery.trim().toLowerCase()
    return (matches ?? []).filter((match) => {
      if (!showCompletedAdminMatches && match.status === 'completed') return false
      if (!query) return true

      const haystack = [teamName(match.team_a), teamName(match.team_b), match.status]
        .join(' ')
        .toLowerCase()

      return haystack.includes(query)
    })
  })

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

  const membershipRoleOptions = [
    { value: 'player', label: 'Player' },
    { value: 'captain', label: 'Captain' },
    { value: 'substitute', label: 'Sub' },
    { value: 'coach', label: 'Coach' },
  ]

  const teamStatusOptions = [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'disbanded', label: 'Disbanded' },
  ]

  const matchStatusOptions = [
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'live', label: 'Live' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
  ]

  const streamPlatformOptions = [
    { value: 'twitch', label: 'Twitch' },
    { value: 'youtube', label: 'YouTube' },
    { value: 'kick', label: 'Kick' },
    { value: 'other', label: 'Other' },
  ]

  const streamStatusOptions = [
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'live', label: 'Live' },
    { value: 'ended', label: 'Ended' },
  ]

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

  function toDatetimeLocal(value: string | null | undefined) {
    if (!value) return ''
    const date = new Date(value)
    const yyyy = date.getFullYear()
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const dd = String(date.getDate()).padStart(2, '0')
    const hh = String(date.getHours()).padStart(2, '0')
    const min = String(date.getMinutes()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`
  }

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
  let userRiotIdForm = $state<Record<string, string>>({})
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
        membershipId: number | null
        profileId: string
        riotId: string
        role: string
        title: string
        message: string
        confirmLabel: string
      }
    | {
        kind: 'finalize_match'
        matchId: string
        teamAScore: string
        teamBScore: string
        winnerTeamId: string
        title: string
        message: string
        confirmLabel: string
      }
    | {
        kind: 'cancel_match'
        matchId: string
        title: string
        message: string
        confirmLabel: string
      }
    | {
        kind: 'save_team'
        teamId: string
        title: string
        message: string
        confirmLabel: string
      }
    | {
        kind: 'save_match'
        matchId: string
        title: string
        message: string
        confirmLabel: string
      }
    | {
        kind: 'delete_match'
        matchId: string
        title: string
        message: string
        confirmLabel: string
      }
    | {
        kind: 'delete_stream'
        matchId: string
        streamId: string
        title: string
        message: string
        confirmLabel: string
      }
    | {
        kind: 'save_user_riot'
        userId: string
        userName: string
        riotIdBase: string
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
      const [usersResponse, seasonsResponse, teamsResponse, matchesResponse] = await Promise.all([
        window.fetch('/api/admin/users'),
        window.fetch('/api/admin/seasons'),
        window.fetch('/api/admin/teams'),
        window.fetch('/api/admin/matches'),
      ])

      if (!usersResponse.ok) {
        const err = await usersResponse.json()
        throw new Error(err.message || 'Failed to fetch users')
      }
      if (!seasonsResponse.ok) {
        const err = await seasonsResponse.json()
        throw new Error(err.message || 'Failed to fetch seasons')
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
      const seasonsResult = await seasonsResponse.json()
      const teamsResult = await teamsResponse.json()
      const matchesResult = await matchesResponse.json()

      users = usersResult.users
      seasons = seasonsResult.seasons
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
      const response = await window.fetch(`/api/admin/matches/${action.matchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'finalize',
          winnerTeamId: action.winnerTeamId,
          teamAScore: Number(action.teamAScore),
          teamBScore: Number(action.teamBScore),
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
      const response = await window.fetch(`/api/admin/matches/${matchId}`, {
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
      const response = await window.fetch('/api/admin/matches', {
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

      const response = await window.fetch('/api/admin/teams', {
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

      const response = await window.fetch(`/api/admin/teams/${teamId}`, {
        method: 'PATCH',
        body: form,
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Failed to update team')

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
      const response = await window.fetch(`/api/admin/matches/${matchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        }),
      })

      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Failed to update match')

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
      const response = await window.fetch(`/api/admin/matches/${matchId}`, { method: 'DELETE' })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Failed to delete match')
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
      const response = await window.fetch(`/api/admin/matches/${matchId}/streams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Failed to add stream')
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
      const response = await window.fetch(`/api/admin/matches/${matchId}/streams`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          streamId,
          platform: state.platform,
          streamUrl: state.streamUrl,
          displayName: state.displayName,
          status: state.status,
          isPrimary: state.isPrimary,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Failed to update stream')
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
      const response = await window.fetch('/api/admin/seasons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: createSeasonCode,
          name: createSeasonName,
          startsOn: createSeasonStartsOn || null,
          endsOn: createSeasonEndsOn || null,
          isActive: createSeasonIsActive,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Failed to create season')
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
      const response = await window.fetch('/api/admin/seasons', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: seasonId,
          code: state.code,
          name: state.name,
          startsOn: state.startsOn || null,
          endsOn: state.endsOn || null,
          isActive: Boolean(state.isActive),
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Failed to update season')
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
      const response = await window.fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, riotIdBase }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Failed to update Riot ID')
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
      const response = await window.fetch(`/api/admin/matches/${matchId}/streams`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamId }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Failed to remove stream')
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
      const res = await window.fetch('/api/admin/teams/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, playerName: state.playerName.trim(), role: state.role }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.message ?? 'Failed to add player')

      successMessage = 'Player added to team.'
      updateAddPlayerForm(teamId, { playerName: '', role: 'player' })
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
      const response = await window.fetch('/api/admin/users', {
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
      const response = await window.fetch('/api/admin/teams', {
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
      const response = await window.fetch('/api/admin/teams/logo', {
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
      const response = await window.fetch('/api/admin/teams/manage', {
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
      const response = await window.fetch('/api/admin/teams/manage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, profileId: profileId || null, membershipId }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.message || 'Failed to remove player')
      }

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

    if (action.kind === 'remove_logo') {
      await executeRemoveTeamLogo(action.teamId, action.path)
      return
    }

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

  async function updatePlayerRank(registrationId: number, rankLabel: string) {
    processingRankRegistrationId = registrationId
    errorMessage = null
    try {
      const response = await window.fetch('/api/admin/player-ranks', {
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
      <div class="mb-4 flex flex-wrap justify-end gap-2">
        <a
          href="/admin/leaderboard-import"
          class="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold"
          style="background: rgba(234,179,8,0.18); color: #fcd34d;"
        >
          <Upload size={16} />
          Leaderboard Import
        </a>
        <a
          href="/admin/matches-import"
          class="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold"
          style="background: rgba(168,85,247,0.18); color: #d8b4fe;"
        >
          <Upload size={16} />
          Match Import
        </a>
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
        <UserCog size={48} style="color: var(--text);" class="mb-4" />
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
            class="flex items-center gap-2 border-b-2 px-3 py-3 text-sm sm:px-5 sm:text-base"
            style={activeTab === 'seasons'
              ? 'border-color: var(--accent); color: var(--text); background: rgba(255, 255, 255, 0.05);'
              : 'border-color: transparent; color: rgba(255,255,255,0.7);'}
            onclick={() => (activeTab = 'seasons')}
          >
            <Layers3 size={18} />
            <span>Seasons ({seasons.length})</span>
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

                    <div class="mt-3 flex items-end gap-2">
                      <label class="min-w-0 flex-1 text-xs" style="color: rgba(255,255,255,0.82);">
                        Riot ID
                        <input
                          value={userRiotIdForm[user.id] ?? ''}
                          class="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                          style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                          placeholder="Riot ID base"
                          oninput={(e) => {
                            userRiotIdForm = {
                              ...userRiotIdForm,
                              [user.id]: (e.currentTarget as HTMLInputElement).value,
                            }
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        class="rounded px-3 py-2 text-xs font-semibold"
                        style="background: rgba(59,130,246,0.2); color: #93c5fd;"
                        onclick={() => requestUserRiotIdSave(user.id, user.display_name || '—')}
                      >
                        Save
                      </button>
                    </div>

                    <div class="mt-3 text-xs" style="color: rgba(255,255,255,0.55);">
                      Account-level role management only.
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
                      <th class="px-3 py-2">Riot ID</th>
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
                          <div class="flex items-center gap-2">
                            <input
                              value={userRiotIdForm[user.id] ?? ''}
                              class="w-full max-w-[220px] rounded-md border px-3 py-2 text-sm"
                              style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                              placeholder="Riot ID base"
                              oninput={(e) => {
                                userRiotIdForm = {
                                  ...userRiotIdForm,
                                  [user.id]: (e.currentTarget as HTMLInputElement).value,
                                }
                              }}
                            />
                            <button
                              type="button"
                              class="rounded px-3 py-2 text-xs font-semibold"
                              style="background: rgba(59,130,246,0.2); color: #93c5fd;"
                              onclick={() =>
                                requestUserRiotIdSave(user.id, user.display_name || '—')}
                            >
                              Save
                            </button>
                          </div>
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
                  Tag
                  <input
                    bind:value={createTeamTag}
                    required
                    maxlength="4"
                    minlength="2"
                    class="rounded-md border px-3 py-2"
                    style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                    placeholder="TCR"
                  />
                </label>
                <label class="flex flex-col gap-1 text-sm" style="color: var(--text);">
                  Logo
                  <input
                    bind:this={createTeamLogoInput}
                    type="file"
                    accept="image/*"
                    required
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
                    {@const addState = addPlayerForm[team.id] ?? { playerName: '', role: 'player' }}
                    {@const editState = teamEditForm[team.id] ?? {
                      name: team.name,
                      tag: team.tag ?? '',
                      status: (team as any).status ?? 'active',
                    }}
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

                      <div
                        class="mt-3 rounded-md border p-3"
                        style="border-color: rgba(255,255,255,0.12);"
                      >
                        <div
                          class="mb-2 text-[11px] font-semibold tracking-wide uppercase"
                          style="color: rgba(255,255,255,0.7);"
                        >
                          Team Details
                        </div>
                        <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                          <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                            Name
                            <input
                              value={editState.name}
                              class="mt-1 w-full rounded-md border px-2 py-1 text-sm"
                              style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                              oninput={(e) =>
                                updateTeamEditForm(team.id, {
                                  name: (e.currentTarget as HTMLInputElement).value,
                                })}
                            />
                          </label>
                          <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                            Tag
                            <input
                              value={editState.tag}
                              class="mt-1 w-full rounded-md border px-2 py-1 text-sm"
                              style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                              oninput={(e) =>
                                updateTeamEditForm(team.id, {
                                  tag: (e.currentTarget as HTMLInputElement).value,
                                })}
                            />
                          </label>
                          <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                            Status
                            <div class="mt-1">
                              <CustomSelect
                                options={teamStatusOptions}
                                value={editState.status}
                                compact={true}
                                placeholder="Status"
                                onSelect={(value) => updateTeamEditForm(team.id, { status: value })}
                              />
                            </div>
                          </label>
                          <label
                            class="text-xs md:col-span-2"
                            style="color: rgba(255,255,255,0.82);"
                          >
                            Replace Logo
                            <input
                              type="file"
                              accept="image/*"
                              class="mt-1 w-full rounded-md border px-2 py-1 text-sm"
                              style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                              oninput={(e) => {
                                const file =
                                  (e.currentTarget as HTMLInputElement).files?.[0] ?? null
                                teamLogoFileById = { ...teamLogoFileById, [team.id]: file }
                              }}
                            />
                          </label>
                        </div>
                        <div class="mt-2 flex justify-end">
                          <button
                            type="button"
                            class="rounded px-2 py-1 text-xs font-semibold"
                            style="background: rgba(59,130,246,0.2); color: #93c5fd;"
                            disabled={processingTeamId === team.id}
                            onclick={() => saveTeamEdits(team.id, team.name)}
                          >
                            {processingTeamId === team.id ? 'Saving...' : 'Save Team'}
                          </button>
                        </div>
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
                                      player.player_name ??
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
                                      player.membership_id ?? null,
                                      player.profile_id,
                                      player.riot_id_base ??
                                        player.player_name ??
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
                            <input
                              value={addState.playerName}
                              class="w-full rounded-md border px-3 py-2 text-sm"
                              style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                              placeholder="Enter player name as it should appear"
                              oninput={(e) =>
                                updateAddPlayerForm(team.id, {
                                  playerName: (e.currentTarget as HTMLInputElement).value,
                                })}
                            />
                          </div>
                          <div>
                            <CustomSelect
                              options={membershipRoleOptions}
                              value={addState.role}
                              placeholder="Role"
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
                      Optional. Uses your local browser time.
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

                <div class="mb-3 space-y-3">
                  <input
                    bind:value={matchSearchQuery}
                    class="w-full rounded-lg border px-3 py-2 text-sm md:max-w-md"
                    style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2); color: var(--text);"
                    placeholder="Search teams or match status"
                  />
                  <label
                    class="inline-flex w-full items-center gap-2 text-sm"
                    style="color: rgba(255,255,255,0.8);"
                  >
                    <input bind:checked={showCompletedAdminMatches} type="checkbox" />
                    Show completed matches
                  </label>
                </div>

                {#if filteredAdminMatches.length === 0}
                  <p class="text-sm" style="color: rgba(255,255,255,0.72);">
                    {matches.length === 0
                      ? 'No matches found.'
                      : 'No matches match the current filters.'}
                  </p>
                {:else}
                  <div class="flex flex-col gap-2">
                    {#each filteredAdminMatches as match}
                      {@const state = finalizeForm[match.id] ?? {
                        teamAScore: String(match.team_a_score ?? 0),
                        teamBScore: String(match.team_b_score ?? 0),
                        winnerTeamId: match.winner_team_id ?? match.team_a_id,
                      }}
                      {@const editState = matchEditForm[match.id] ?? {
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
                      }}
                      {@const streamState = streamForm[match.id] ?? {
                        platform: 'twitch',
                        streamUrl: '',
                        status: match.status === 'live' ? 'live' : 'scheduled',
                        isPrimary: !(match.streams?.length > 0),
                      }}
                      <article
                        class="rounded-md border p-3"
                        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
                      >
                        <button
                          type="button"
                          class="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                          onclick={() =>
                            (expandedAdminMatchId =
                              expandedAdminMatchId === match.id ? null : match.id)}
                        >
                          <div>
                            <div class="text-sm" style="color: var(--text);">
                              <strong>{teamName(match.team_a)}</strong> vs
                              <strong>{teamName(match.team_b)}</strong>
                            </div>
                            <div class="mt-1 text-xs" style="color: rgba(255,255,255,0.68);">
                              BO{match.best_of}
                              {#if match.scheduled_at}
                                <span>
                                  • {toDatetimeLocal(match.scheduled_at).replace('T', ' ')}</span
                                >
                              {/if}
                              {#if match.status === 'completed'}
                                <span> • {match.team_a_score}-{match.team_b_score}</span>
                              {/if}
                            </div>
                          </div>
                          <div class="flex items-center gap-2">
                            <span
                              class="rounded-full px-2 py-1 text-xs font-bold"
                              style="background: rgba(255,255,255,0.12); color: var(--text);"
                            >
                              {match.status}
                            </span>
                            <span class="text-xs" style="color: rgba(255,255,255,0.7);">
                              {expandedAdminMatchId === match.id ? 'Hide' : 'Show'}
                            </span>
                          </div>
                        </button>

                        {#if expandedAdminMatchId === match.id}
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
                            <CustomSelect
                              options={[
                                { value: match.team_a_id, label: teamName(match.team_a) },
                                { value: match.team_b_id, label: teamName(match.team_b) },
                              ]}
                              value={state.winnerTeamId}
                              compact={true}
                              placeholder="Winner"
                              onSelect={(value) =>
                                updateFinalizeForm(match.id, {
                                  winnerTeamId: value,
                                })}
                            />
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

                          <div
                            class="mt-3 rounded-md border p-3"
                            style="border-color: rgba(255,255,255,0.10);"
                          >
                            <div
                              class="mb-2 text-[11px] font-semibold tracking-wide uppercase"
                              style="color: rgba(255,255,255,0.7);"
                            >
                              Edit Match
                            </div>
                            <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                              <div>
                                <CustomSelect
                                  options={approvedTeamOptions}
                                  value={editState.teamAId}
                                  compact={true}
                                  placeholder="Team A"
                                  onSelect={(value) =>
                                    updateMatchEditForm(match.id, { teamAId: value })}
                                />
                              </div>
                              <div>
                                <CustomSelect
                                  options={approvedTeamOptions}
                                  value={editState.teamBId}
                                  compact={true}
                                  placeholder="Team B"
                                  onSelect={(value) =>
                                    updateMatchEditForm(match.id, { teamBId: value })}
                                />
                              </div>
                              <div>
                                <CustomSelect
                                  options={bestOfOptions}
                                  value={editState.bestOf}
                                  compact={true}
                                  placeholder="Best Of"
                                  onSelect={(value) =>
                                    updateMatchEditForm(match.id, { bestOf: value })}
                                />
                              </div>
                              <div>
                                <CustomSelect
                                  options={matchStatusOptions}
                                  value={editState.status}
                                  compact={true}
                                  placeholder="Status"
                                  onSelect={(value) =>
                                    updateMatchEditForm(match.id, { status: value })}
                                />
                              </div>
                              <label
                                class="text-xs md:col-span-2"
                                style="color: rgba(255,255,255,0.82);"
                              >
                                Scheduled
                                <input
                                  type="datetime-local"
                                  value={editState.scheduledAt}
                                  class="mt-1 w-full rounded-md border px-2 py-1 text-sm"
                                  style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                                  oninput={(e) =>
                                    updateMatchEditForm(match.id, {
                                      scheduledAt: (e.currentTarget as HTMLInputElement).value,
                                    })}
                                />
                              </label>
                              <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                                Team A Score
                                <input
                                  type="number"
                                  min="0"
                                  value={editState.teamAScore}
                                  class="mt-1 w-full rounded-md border px-2 py-1 text-sm"
                                  style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                                  oninput={(e) =>
                                    updateMatchEditForm(match.id, {
                                      teamAScore: (e.currentTarget as HTMLInputElement).value,
                                    })}
                                />
                              </label>
                              <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                                Team B Score
                                <input
                                  type="number"
                                  min="0"
                                  value={editState.teamBScore}
                                  class="mt-1 w-full rounded-md border px-2 py-1 text-sm"
                                  style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                                  oninput={(e) =>
                                    updateMatchEditForm(match.id, {
                                      teamBScore: (e.currentTarget as HTMLInputElement).value,
                                    })}
                                />
                              </label>
                              <div class="md:col-span-2">
                                <CustomSelect
                                  options={[
                                    { value: '', label: 'Unset winner' },
                                    {
                                      value: editState.teamAId,
                                      label:
                                        approvedTeams.find((team) => team.id === editState.teamAId)
                                          ?.name ?? 'Team A',
                                    },
                                    {
                                      value: editState.teamBId,
                                      label:
                                        approvedTeams.find((team) => team.id === editState.teamBId)
                                          ?.name ?? 'Team B',
                                    },
                                  ]}
                                  value={editState.winnerTeamId}
                                  compact={true}
                                  placeholder="Winner"
                                  onSelect={(value) =>
                                    updateMatchEditForm(match.id, { winnerTeamId: value })}
                                />
                              </div>
                            </div>
                            <div class="mt-3 flex flex-wrap justify-end gap-2">
                              <button
                                type="button"
                                class="rounded px-2 py-1 text-xs font-semibold"
                                style="background: rgba(59,130,246,0.2); color: #93c5fd;"
                                onclick={() => saveMatchEdits(match.id, match)}
                              >
                                Save Match
                              </button>
                              <button
                                type="button"
                                class="rounded px-2 py-1 text-xs font-semibold"
                                style="background: rgba(248,113,113,0.2); color: #fca5a5;"
                                onclick={() => deleteMatch(match.id, match)}
                              >
                                Delete Match
                              </button>
                            </div>
                          </div>

                          <div
                            class="mt-3 rounded-md border p-3"
                            style="border-color: rgba(255,255,255,0.10);"
                          >
                            <div
                              class="mb-2 text-[11px] font-semibold tracking-wide uppercase"
                              style="color: rgba(255,255,255,0.7);"
                            >
                              Map Vetoes
                            </div>
                            <textarea
                              rows="5"
                              value={editState.mapVetoes}
                              class="w-full rounded-md border px-3 py-2 text-sm leading-5"
                              style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                              placeholder={`One line per veto item\nBan: Team A - Haven\nPick: Team B - Lotus\nDecider: Pearl`}
                              oninput={(e) =>
                                updateMatchEditForm(match.id, {
                                  mapVetoes: (e.currentTarget as HTMLTextAreaElement).value,
                                })}
                            ></textarea>
                            <div class="mt-2 flex items-center justify-between gap-2">
                              <div class="text-[11px]" style="color: rgba(255,255,255,0.6);">
                                Saves via the same match update flow.
                              </div>
                              <button
                                type="button"
                                class="rounded px-3 py-2 text-xs font-semibold"
                                style="background: rgba(59,130,246,0.2); color: #93c5fd;"
                                onclick={() => saveMatchEdits(match.id, match)}
                              >
                                Save Vetoes
                              </button>
                            </div>
                          </div>

                          <div
                            class="mt-3 rounded-md border p-3"
                            style="border-color: rgba(255,255,255,0.10);"
                          >
                            <div
                              class="mb-2 text-[11px] font-semibold tracking-wide uppercase"
                              style="color: rgba(255,255,255,0.7);"
                            >
                              Streams
                            </div>
                            {#if (match.streams ?? []).length > 0}
                              <div class="mb-3 flex flex-col gap-2">
                                {#each match.streams as stream}
                                  {@const existingState = existingStreamForm[stream.id] ?? {
                                    platform: stream.platform,
                                    streamUrl: stream.stream_url,
                                    status: stream.status,
                                    isPrimary: stream.is_primary,
                                  }}
                                  <div
                                    class="rounded-md border px-2 py-2 text-xs"
                                    style="border-color: rgba(255,255,255,0.10); background: rgba(255,255,255,0.04);"
                                  >
                                    <div class="min-w-0">
                                      <div style="color: var(--text);">
                                        {stream.metadata?.display_name || stream.platform}
                                        {stream.is_primary ? '• Primary' : ''}
                                      </div>
                                      <div class="truncate" style="color: rgba(255,255,255,0.68);">
                                        {stream.stream_url}
                                      </div>
                                    </div>
                                    <div class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
                                      <div class="md:col-span-2">
                                        <input
                                          class="w-full rounded-md border px-3 py-2 text-sm"
                                          style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                                          value={existingState.displayName}
                                          placeholder="Display name"
                                          oninput={(e) => {
                                            existingStreamForm = {
                                              ...existingStreamForm,
                                              [stream.id]: {
                                                ...existingState,
                                                displayName: (e.currentTarget as HTMLInputElement)
                                                  .value,
                                              },
                                            }
                                          }}
                                        />
                                      </div>
                                    </div>
                                    <div class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
                                      <div>
                                        <CustomSelect
                                          options={streamPlatformOptions}
                                          value={existingState.platform}
                                          compact={true}
                                          placeholder="Platform"
                                          onSelect={(value) => {
                                            existingStreamForm = {
                                              ...existingStreamForm,
                                              [stream.id]: { ...existingState, platform: value },
                                            }
                                          }}
                                        />
                                      </div>
                                      <div class="md:col-span-2">
                                        <input
                                          class="w-full rounded-md border px-3 py-2 text-sm"
                                          style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                                          value={existingState.streamUrl}
                                          oninput={(e) => {
                                            existingStreamForm = {
                                              ...existingStreamForm,
                                              [stream.id]: {
                                                ...existingState,
                                                streamUrl: (e.currentTarget as HTMLInputElement)
                                                  .value,
                                              },
                                            }
                                          }}
                                        />
                                      </div>
                                      <div>
                                        <CustomSelect
                                          options={streamStatusOptions}
                                          value={existingState.status}
                                          compact={true}
                                          placeholder="Stream status"
                                          onSelect={(value) => {
                                            existingStreamForm = {
                                              ...existingStreamForm,
                                              [stream.id]: { ...existingState, status: value },
                                            }
                                          }}
                                        />
                                      </div>
                                    </div>
                                    <div
                                      class="mt-2 flex flex-wrap items-center justify-between gap-2"
                                    >
                                      <label
                                        class="inline-flex items-center gap-2 text-xs"
                                        style="color: rgba(255,255,255,0.82);"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={existingState.isPrimary}
                                          onchange={(e) => {
                                            existingStreamForm = {
                                              ...existingStreamForm,
                                              [stream.id]: {
                                                ...existingState,
                                                isPrimary: (e.currentTarget as HTMLInputElement)
                                                  .checked,
                                              },
                                            }
                                          }}
                                        />
                                        Mark as primary stream
                                      </label>
                                      <div class="flex gap-2">
                                        <button
                                          type="button"
                                          class="rounded px-2 py-1 text-[11px] font-semibold"
                                          style="background: rgba(59,130,246,0.2); color: #93c5fd;"
                                          onclick={() =>
                                            saveExistingMatchStream(match.id, stream.id)}
                                        >
                                          Save
                                        </button>
                                        <button
                                          type="button"
                                          class="rounded px-2 py-1 text-[11px] font-semibold"
                                          style="background: rgba(248,113,113,0.2); color: #fca5a5;"
                                          onclick={() =>
                                            removeMatchStream(match.id, stream.id, stream.platform)}
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                {/each}
                              </div>
                            {/if}

                            <div class="grid grid-cols-1 gap-2 md:grid-cols-4">
                              <div class="md:col-span-2">
                                <input
                                  class="w-full rounded-md border px-3 py-2 text-sm"
                                  style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                                  value={streamState.displayName}
                                  placeholder="Display name"
                                  oninput={(e) => {
                                    streamForm = {
                                      ...streamForm,
                                      [match.id]: {
                                        ...streamState,
                                        displayName: (e.currentTarget as HTMLInputElement).value,
                                      },
                                    }
                                  }}
                                />
                              </div>
                            </div>
                            <div class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
                              <div>
                                <CustomSelect
                                  options={streamPlatformOptions}
                                  value={streamState.platform}
                                  compact={true}
                                  placeholder="Platform"
                                  onSelect={(value) => {
                                    streamForm = {
                                      ...streamForm,
                                      [match.id]: {
                                        ...streamState,
                                        platform: value,
                                      },
                                    }
                                  }}
                                />
                              </div>
                              <div class="md:col-span-2">
                                <input
                                  class="w-full rounded-md border px-3 py-2 text-sm"
                                  style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                                  value={streamState.streamUrl}
                                  placeholder="Input stream link here"
                                  oninput={(e) => {
                                    streamForm = {
                                      ...streamForm,
                                      [match.id]: {
                                        ...streamState,
                                        streamUrl: (e.currentTarget as HTMLInputElement).value,
                                      },
                                    }
                                  }}
                                />
                              </div>
                              <div>
                                <CustomSelect
                                  options={streamStatusOptions}
                                  value={streamState.status}
                                  compact={true}
                                  placeholder="Stream status"
                                  onSelect={(value) => {
                                    streamForm = {
                                      ...streamForm,
                                      [match.id]: {
                                        ...streamState,
                                        status: value,
                                      },
                                    }
                                  }}
                                />
                              </div>
                            </div>
                            <label
                              class="mt-2 inline-flex items-center gap-2 text-xs"
                              style="color: rgba(255,255,255,0.82);"
                            >
                              <input
                                type="checkbox"
                                checked={streamState.isPrimary}
                                onchange={(e) => {
                                  streamForm = {
                                    ...streamForm,
                                    [match.id]: {
                                      ...streamState,
                                      isPrimary: (e.currentTarget as HTMLInputElement).checked,
                                    },
                                  }
                                }}
                              />
                              Mark as primary stream
                            </label>
                            <div class="mt-2 flex justify-end">
                              <button
                                type="button"
                                class="rounded px-2 py-1 text-xs font-semibold"
                                style="background: rgba(34,197,94,0.2); color: #86efac;"
                                onclick={() => addMatchStream(match.id)}
                              >
                                Add Stream
                              </button>
                            </div>

                            <div
                              class="mt-4 border-t pt-4"
                              style="border-color: rgba(255,255,255,0.10);"
                            >
                              <div
                                class="mb-2 text-[11px] font-semibold tracking-wide uppercase"
                                style="color: rgba(255,255,255,0.7);"
                              >
                                YouTube VOD
                              </div>
                              <div class="flex flex-col gap-2 md:flex-row">
                                <input
                                  class="w-full flex-1 rounded-md border px-3 py-2 text-sm"
                                  style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                                  value={vodForm[match.id] ?? ''}
                                  placeholder="https://youtube.com/watch?..."
                                  oninput={(e) => {
                                    vodForm = {
                                      ...vodForm,
                                      [match.id]: (e.currentTarget as HTMLInputElement).value,
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  class="rounded px-3 py-2 text-xs font-semibold"
                                  style="background: rgba(234,179,8,0.18); color: #fcd34d;"
                                  onclick={() => saveMatchEdits(match.id, match)}
                                >
                                  Save VOD
                                </button>
                              </div>
                              <div class="mt-2 text-[11px]" style="color: rgba(255,255,255,0.6);">
                                Saves via the same match update flow.
                              </div>
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
                        {/if}
                      </article>
                    {/each}
                  </div>
                {/if}
              </section>
            </div>
          {/if}

          {#if activeTab === 'seasons'}
            <div class="grid grid-cols-1 gap-4">
              <section class="rounded-md border p-3" style="border-color: rgba(255,255,255,0.12);">
                <div class="mb-3 flex items-center gap-2">
                  <Layers3 size={18} />
                  <h3
                    class="text-sm font-semibold tracking-wide uppercase"
                    style="color: rgba(255,255,255,0.8);"
                  >
                    Create Season
                  </h3>
                </div>

                <div class="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
                  <input
                    bind:value={createSeasonCode}
                    placeholder="Code (rivals4)"
                    class="rounded-md border px-3 py-2 text-sm"
                    style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                  />
                  <input
                    bind:value={createSeasonName}
                    placeholder="Name (Rivals 4)"
                    class="rounded-md border px-3 py-2 text-sm xl:col-span-2"
                    style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                  />
                  <input
                    type="date"
                    bind:value={createSeasonStartsOn}
                    class="rounded-md border px-3 py-2 text-sm"
                    style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                  />
                  <input
                    type="date"
                    bind:value={createSeasonEndsOn}
                    class="rounded-md border px-3 py-2 text-sm"
                    style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                  />
                </div>
                <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <label
                    class="inline-flex items-center gap-2 text-sm"
                    style="color: rgba(255,255,255,0.82);"
                  >
                    <input type="checkbox" bind:checked={createSeasonIsActive} />
                    Set as active season
                  </label>
                  <button
                    type="button"
                    class="rounded-md px-3 py-2 text-sm font-semibold"
                    style="background: rgba(74,222,128,0.2); color: #86efac;"
                    onclick={createSeason}
                    disabled={isCreatingSeason}
                  >
                    {isCreatingSeason ? 'Creating...' : 'Create Season'}
                  </button>
                </div>
              </section>

              <section class="rounded-md border p-3" style="border-color: rgba(255,255,255,0.12);">
                <div class="mb-3 flex items-center gap-2">
                  <Layers3 size={18} />
                  <h3
                    class="text-sm font-semibold tracking-wide uppercase"
                    style="color: rgba(255,255,255,0.8);"
                  >
                    Seasons ({seasons.length})
                  </h3>
                </div>

                {#if seasons.length === 0}
                  <div class="text-sm" style="color: rgba(255,255,255,0.72);">
                    No seasons created yet.
                  </div>
                {:else}
                  <div class="flex flex-col gap-3">
                    {#each seasons as season}
                      {@const state = seasonEditForm[season.id] ?? {
                        code: season.code ?? '',
                        name: season.name ?? '',
                        startsOn: season.starts_on ?? '',
                        endsOn: season.ends_on ?? '',
                        isActive: Boolean(season.is_active),
                      }}
                      <article
                        class="rounded-md border p-3"
                        style="border-color: rgba(255,255,255,0.10); background: rgba(0,0,0,0.18);"
                      >
                        <div class="mb-2 flex items-center justify-between gap-2">
                          <div class="font-semibold" style="color: var(--text);">{season.name}</div>
                          {#if season.is_active}
                            <span
                              class="rounded-full px-2 py-1 text-xs font-bold"
                              style="background: rgba(74,222,128,0.18); color: #86efac;"
                              >Active</span
                            >
                          {/if}
                        </div>
                        <div class="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
                          <input
                            value={state.code}
                            oninput={(e) =>
                              (seasonEditForm = {
                                ...seasonEditForm,
                                [season.id]: {
                                  ...state,
                                  code: (e.currentTarget as HTMLInputElement).value,
                                },
                              })}
                            class="rounded-md border px-3 py-2 text-sm"
                            style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                          />
                          <input
                            value={state.name}
                            oninput={(e) =>
                              (seasonEditForm = {
                                ...seasonEditForm,
                                [season.id]: {
                                  ...state,
                                  name: (e.currentTarget as HTMLInputElement).value,
                                },
                              })}
                            class="rounded-md border px-3 py-2 text-sm xl:col-span-2"
                            style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                          />
                          <input
                            type="date"
                            value={state.startsOn}
                            oninput={(e) =>
                              (seasonEditForm = {
                                ...seasonEditForm,
                                [season.id]: {
                                  ...state,
                                  startsOn: (e.currentTarget as HTMLInputElement).value,
                                },
                              })}
                            class="rounded-md border px-3 py-2 text-sm"
                            style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                          />
                          <input
                            type="date"
                            value={state.endsOn}
                            oninput={(e) =>
                              (seasonEditForm = {
                                ...seasonEditForm,
                                [season.id]: {
                                  ...state,
                                  endsOn: (e.currentTarget as HTMLInputElement).value,
                                },
                              })}
                            class="rounded-md border px-3 py-2 text-sm"
                            style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                          />
                        </div>
                        <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
                          <label
                            class="inline-flex items-center gap-2 text-sm"
                            style="color: rgba(255,255,255,0.82);"
                          >
                            <input
                              type="checkbox"
                              checked={state.isActive}
                              onchange={(e) =>
                                (seasonEditForm = {
                                  ...seasonEditForm,
                                  [season.id]: {
                                    ...state,
                                    isActive: (e.currentTarget as HTMLInputElement).checked,
                                  },
                                })}
                            />
                            Active season
                          </label>
                          <button
                            type="button"
                            class="rounded-md px-3 py-2 text-sm font-semibold"
                            style="background: rgba(59,130,246,0.18); color: #93c5fd;"
                            onclick={() => saveSeason(season.id)}
                          >
                            Save Season
                          </button>
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
