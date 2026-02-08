<script lang="ts">
  import { page } from '$app/stores'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { Shield, Users, Video, RefreshCw, UserCog, ShieldCheck, Check, X } from 'lucide-svelte'
  import { TEAM_BALANCE_RANKS } from '$lib/team-balance'

  // Get data from server load
  let { data } = $props()

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
      riot_id: string
      display_name: string | null
      email: string | null
    }>
    profiles?: { id?: string; display_name?: string | null; email?: string | null }[] | null
    captain_profile?: { display_name?: string | null; email?: string | null } | null
  }

  let activeTab = $state<'players' | 'observers' | 'users' | 'teams'>('players')
  let isLoading = $state(false)
  let errorMessage = $state<string | null>(null)
  let successMessage = $state<string | null>(null)

  const getInitialPlayers = () => data.players || []
  const getInitialObservers = () => data.observers || []
  const getInitialUsers = () => data.users || []
  const getInitialTeamQueue = () => data.teamQueue || []
  const getInitialApprovedTeams = () => data.approvedTeams || []

  let players = $state<any[]>(getInitialPlayers())
  let observers = $state<any[]>(getInitialObservers())
  let users = $state<any[]>(getInitialUsers())
  let teamQueue = $state<TeamQueueEntry[]>(getInitialTeamQueue())
  let approvedTeams = $state<TeamQueueEntry[]>(getInitialApprovedTeams())

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
    | null
  >(null)

  const rankOptions = TEAM_BALANCE_RANKS.map((rank) => rank.name)
  const rankSelectOptions = [
    { value: '', label: 'Select rank' },
    ...rankOptions.map((r) => ({ value: r, label: r })),
  ]
  const roleSelectOptions = [
    { value: 'user', label: 'User' },
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

  const displayedTeamQueue = $derived.by(() => {
    const search = normalizeSearchValue(teamsSearch)
    return teamQueue.filter((team) => {
      if (!search) return true
      const submitter = team.profiles?.[0]?.display_name || team.profiles?.[0]?.email || ''
      const haystack = `${team.name ?? ''} ${team.tag ?? ''} ${submitter}`.toLowerCase()
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
      const [regResponse, usersResponse, teamsResponse] = await Promise.all([
        fetch('/api/admin/registrations'),
        fetch('/api/admin/users'),
        fetch('/api/admin/teams'),
      ])

      if (!regResponse.ok) {
        const err = await regResponse.json()
        throw new Error(err.message || 'Failed to fetch registrations')
      }
      if (!usersResponse.ok) {
        const err = await usersResponse.json()
        throw new Error(err.message || 'Failed to fetch users')
      }
      if (!teamsResponse.ok) {
        const err = await teamsResponse.json()
        throw new Error(err.message || 'Failed to fetch team queue')
      }

      const regResult = await regResponse.json()
      const usersResult = await usersResponse.json()
      const teamsResult = await teamsResponse.json()

      players = regResult.players
      observers = regResult.observers
      users = usersResult.users
      teamQueue = teamsResult.queue
      approvedTeams = teamsResult.approved
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to refresh data'
    } finally {
      isLoading = false
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
      message: `Are you sure you want to remove ${label} from this team?`,
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
            style={activeTab === 'players'
              ? 'border-color: var(--accent); color: var(--text); background: rgba(255, 255, 255, 0.05);'
              : 'border-color: transparent; color: rgba(255,255,255,0.7);'}
            onclick={() => (activeTab = 'players')}
          >
            <Users size={18} />
            <span>Players ({players.length})</span>
          </button>
          <button
            type="button"
            class="flex items-center gap-2 border-b-2 px-3 py-3 text-sm sm:px-5 sm:text-base"
            style={activeTab === 'observers'
              ? 'border-color: var(--accent); color: var(--text); background: rgba(255, 255, 255, 0.05);'
              : 'border-color: transparent; color: rgba(255,255,255,0.7);'}
            onclick={() => (activeTab = 'observers')}
          >
            <Video size={18} />
            <span>Observers ({observers.length})</span>
          </button>
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
            <span>Team Queue ({teamQueue.length})</span>
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
          {#if activeTab === 'players'}
            {#if players.length === 0}
              <div class="py-10 text-center" style="color: rgba(255,255,255,0.72);">
                No player registrations yet.
              </div>
            {:else}
              <div
                class="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
                style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.18);"
              >
                <span class="text-sm" style="color: rgba(255,255,255,0.8);">
                  Showing {displayedPlayers.length} of {players.length} players
                </span>
                <label class="inline-flex items-center gap-2 text-sm" style="color: var(--text);">
                  <input
                    type="checkbox"
                    bind:checked={showUnrankedOnly}
                    class="h-4 w-4"
                    style="accent-color: var(--accent);"
                  />
                  <span>Unranked only</span>
                </label>
              </div>

              <input
                bind:value={playersSearch}
                placeholder="Search players by Riot ID, Discord, pronouns"
                class="mb-3 w-full rounded-md border px-3 py-2 text-sm"
                style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
              />

              <div class="space-y-3 md:hidden">
                {#each displayedPlayers as player}
                  <article
                    class="rounded-lg border p-3"
                    style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
                  >
                    <div class="mb-2 font-semibold" style="color: var(--title);">
                      {player.riot_id}
                    </div>
                    <div class="space-y-1 text-sm">
                      <div>
                        <span class="opacity-70">Discord:</span>
                        {profileLabel(player.profiles)}
                      </div>
                      <div><span class="opacity-70">Pronouns:</span> {player.pronouns}</div>
                      <div class="space-y-1">
                        <span class="opacity-70">Rank:</span>
                        <div class="w-44">
                          <CustomSelect
                            options={rankSelectOptions}
                            value={player.rank_label ?? ''}
                            placeholder="Select rank"
                            compact={true}
                            disabled={processingRankRegistrationId === player.id}
                            onSelect={(value) =>
                              requestRankChange(
                                player.id,
                                player.riot_id,
                                player.rank_label ?? '',
                                value
                              )}
                          />
                        </div>
                      </div>
                      <div class="flex flex-wrap gap-2">
                        <span class="opacity-70">Links:</span>
                        {#if player.tracker_links?.length > 0}
                          {#each player.tracker_links as link, i}
                            <a
                              href={link}
                              target="_blank"
                              rel="noopener noreferrer"
                              style="color: #a78bfa;">Link {i + 1}</a
                            >
                          {/each}
                        {:else}
                          <span>—</span>
                        {/if}
                      </div>
                    </div>
                  </article>
                {/each}
              </div>

              <div class="hidden overflow-x-auto md:block">
                <table class="w-full text-left text-sm">
                  <thead>
                    <tr class="text-xs tracking-wide uppercase opacity-70">
                      <th class="px-3 py-2">Riot ID</th>
                      <th class="px-3 py-2">Discord</th>
                      <th class="px-3 py-2">Pronouns</th>
                      <th class="px-3 py-2">Rank</th>
                      <th class="px-3 py-2">Tracker Links</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each displayedPlayers as player}
                      <tr class="border-t" style="border-color: rgba(255,255,255,0.1);">
                        <td class="px-3 py-2 font-semibold">{player.riot_id}</td>
                        <td class="px-3 py-2">
                          {profileLabel(player.profiles)}
                        </td>
                        <td class="px-3 py-2">{player.pronouns}</td>
                        <td class="px-3 py-2">
                          <div class="w-44">
                            <CustomSelect
                              options={rankSelectOptions}
                              value={player.rank_label ?? ''}
                              placeholder="Select rank"
                              compact={true}
                              disabled={processingRankRegistrationId === player.id}
                              onSelect={(value) =>
                                requestRankChange(
                                  player.id,
                                  player.riot_id,
                                  player.rank_label ?? '',
                                  value
                                )}
                            />
                          </div>
                        </td>
                        <td class="px-3 py-2">
                          <div class="flex flex-wrap gap-2">
                            {#if player.tracker_links?.length > 0}
                              {#each player.tracker_links as link, i}
                                <a
                                  href={link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style="color: #a78bfa;">Link {i + 1}</a
                                >
                              {/each}
                            {:else}
                              —
                            {/if}
                          </div>
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          {/if}

          {#if activeTab === 'observers'}
            {#if observers.length === 0}
              <div class="py-10 text-center" style="color: rgba(255,255,255,0.72);">
                No observer applications yet.
              </div>
            {:else}
              <input
                bind:value={observersSearch}
                placeholder="Search observers by Discord or notes"
                class="mb-3 w-full rounded-md border px-3 py-2 text-sm"
                style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
              />
              <div class="space-y-3 md:hidden">
                {#each displayedObservers as observer}
                  <article
                    class="rounded-lg border p-3"
                    style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
                  >
                    <div class="mb-2 font-semibold" style="color: var(--title);">
                      {profileLabel(observer.profiles)}
                    </div>
                    <div class="space-y-1 text-sm">
                      <div>
                        <span class="opacity-70">Experience:</span>
                        {observer.has_previous_experience ? 'Yes' : 'No'}
                      </div>
                      <div>
                        <span class="opacity-70">Can Stream 1080p60:</span>
                        {observer.can_stream_quality ? 'Yes' : 'No'}
                      </div>
                      <div>
                        <span class="opacity-70">Will Use Overlay:</span>
                        {observer.willing_to_use_overlay ? 'Yes' : 'No'}
                      </div>
                      <div>
                        <span class="opacity-70">Additional Info:</span>
                        {observer.additional_info}
                      </div>
                    </div>
                  </article>
                {/each}
              </div>

              <div class="hidden overflow-x-auto md:block">
                <table class="w-full text-left text-sm">
                  <thead>
                    <tr class="text-xs tracking-wide uppercase opacity-70">
                      <th class="px-3 py-2">Discord</th>
                      <th class="px-3 py-2">Experience</th>
                      <th class="px-3 py-2">Can Stream 1080p60</th>
                      <th class="px-3 py-2">Will Use Overlay</th>
                      <th class="px-3 py-2">Additional Info</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each displayedObservers as observer}
                      <tr class="border-t" style="border-color: rgba(255,255,255,0.1);">
                        <td class="px-3 py-2 font-semibold">
                          {profileLabel(observer.profiles)}
                        </td>
                        <td class="px-3 py-2">{observer.has_previous_experience ? 'Yes' : 'No'}</td>
                        <td class="px-3 py-2">{observer.can_stream_quality ? 'Yes' : 'No'}</td>
                        <td class="px-3 py-2">{observer.willing_to_use_overlay ? 'Yes' : 'No'}</td>
                        <td class="px-3 py-2">{observer.additional_info}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          {/if}

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
                  </article>
                {/each}
              </div>

              <div class="hidden overflow-x-auto md:block">
                <table class="w-full text-left text-sm">
                  <thead>
                    <tr class="text-xs tracking-wide uppercase opacity-70">
                      <th class="px-3 py-2">Discord</th>
                      <th class="px-3 py-2">Role</th>
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
                Team Queue ({displayedTeamQueue.length})
              </h3>
              {#if displayedTeamQueue.length === 0}
                <div class="py-6 text-center text-sm" style="color: rgba(255,255,255,0.72);">
                  No pending team submissions.
                </div>
              {:else}
                <div class="flex flex-col gap-4">
                  {#each displayedTeamQueue as team}
                    <form
                      class="rounded-lg border p-4"
                      style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
                      onsubmit={(e) => {
                        e.preventDefault()
                        const form = e.currentTarget as HTMLFormElement
                        const fields = new FormData(form)
                        requestTeamModeration(
                          team.id,
                          'approve',
                          String(fields.get('notes') ?? ''),
                          String(fields.get('name') ?? ''),
                          String(fields.get('tag') ?? ''),
                          String(fields.get('logoPath') ?? '')
                        )
                      }}
                    >
                      <div
                        class="mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-start"
                      >
                        <div>
                          <h3 class="text-lg font-bold" style="color: var(--title);">
                            {team.name}
                          </h3>
                          <p class="text-sm" style="color: rgba(255,255,255,0.75);">
                            Submitted by {team.profiles?.[0]?.display_name ||
                              team.profiles?.[0]?.email ||
                              'Unknown user'}
                          </p>
                        </div>
                        <span
                          class="w-fit rounded-full px-2 py-1 text-xs font-bold tracking-wide uppercase"
                          style="background: rgba(250, 204, 21, 0.2); color: #facc15;"
                        >
                          {team.approval_status}
                        </span>
                      </div>

                      <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
                        <label class="flex flex-col gap-1 text-sm" style="color: var(--text);">
                          Team Name
                          <input
                            name="name"
                            value={team.name}
                            required
                            minlength="2"
                            maxlength="48"
                            class="rounded-md border px-3 py-2"
                            style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                          />
                        </label>
                        <label class="flex flex-col gap-1 text-sm" style="color: var(--text);">
                          Tag
                          <input
                            name="tag"
                            value={team.tag ?? ''}
                            maxlength="4"
                            minlength="2"
                            required
                            class="rounded-md border px-3 py-2"
                            style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                          />
                        </label>
                        <label class="flex flex-col gap-1 text-sm" style="color: var(--text);">
                          Logo Path
                          <input
                            name="logoPath"
                            value={team.logo_path ?? ''}
                            maxlength="255"
                            class="rounded-md border px-3 py-2"
                            style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                          />
                        </label>
                      </div>

                      {#if team.logo_path}
                        <div
                          class="mt-3 flex items-center gap-2 rounded-md border p-2"
                          style="border-color: rgba(255,255,255,0.18);"
                        >
                          {#if team.logo_url}
                            <img
                              src={team.logo_url}
                              alt="Team logo"
                              class="h-10 w-10 rounded object-contain"
                            />
                          {/if}
                          <div class="text-xs break-all" style="color: rgba(255,255,255,0.8);">
                            {team.logo_path}
                          </div>
                          <button
                            type="button"
                            class="ml-auto rounded-md px-2 py-1 text-xs font-semibold"
                            style="background: rgba(185,28,28,0.25); color: #f87171;"
                            onclick={() => removeTeamLogo(team.id, team.logo_path!)}
                            disabled={processingTeamId === team.id}
                          >
                            Remove Logo
                          </button>
                        </div>
                      {/if}

                      {#if (team.metadata?.initial_roster ?? []).length > 0}
                        <div
                          class="mt-3 rounded-md border p-2"
                          style="border-color: rgba(255,255,255,0.18);"
                        >
                          <div
                            class="mb-2 text-xs font-semibold tracking-wide uppercase"
                            style="color: rgba(255,255,255,0.75);"
                          >
                            Proposed Players
                          </div>
                          <div class="flex flex-wrap gap-2">
                            {#each team.metadata?.initial_roster ?? [] as player}
                              <span
                                class="rounded-full px-2 py-1 text-xs"
                                style="background: rgba(255,255,255,0.08); color: var(--text);"
                              >
                                {player.riot_id || 'Unknown'}
                                {#if player.rank_label}
                                  <span class="opacity-70"> - {player.rank_label}</span>
                                {/if}
                              </span>
                            {/each}
                          </div>
                        </div>
                      {/if}

                      <label class="mt-3 flex flex-col gap-1 text-sm" style="color: var(--text);">
                        Moderation Notes
                        <textarea
                          name="notes"
                          rows="3"
                          class="rounded-md border px-3 py-2"
                          style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                          placeholder="Reason for decision or required edits."
                        ></textarea>
                      </label>

                      <div class="mt-3 flex gap-2">
                        <button
                          type="submit"
                          class="inline-flex items-center gap-1 rounded-md px-3 py-2 font-bold text-white"
                          style="background: #15803d;"
                          disabled={processingTeamId === team.id}
                        >
                          <Check size={16} />
                          Approve
                        </button>
                        <button
                          type="button"
                          class="inline-flex items-center gap-1 rounded-md px-3 py-2 font-bold text-white"
                          style="background: #b91c1c;"
                          disabled={processingTeamId === team.id}
                          onclick={(e) => {
                            const form = (e.currentTarget as HTMLElement).closest(
                              'form'
                            ) as HTMLFormElement
                            const fields = new FormData(form)
                            requestTeamModeration(
                              team.id,
                              'reject',
                              String(fields.get('notes') ?? ''),
                              String(fields.get('name') ?? ''),
                              String(fields.get('tag') ?? ''),
                              String(fields.get('logoPath') ?? '')
                            )
                          }}
                        >
                          <X size={16} />
                          Reject
                        </button>
                      </div>
                    </form>
                  {/each}
                </div>
              {/if}
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
                                  <span class="font-semibold">{player.riot_id}</span>
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
                                      player.riot_id,
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
