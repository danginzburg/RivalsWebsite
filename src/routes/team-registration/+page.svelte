<script lang="ts">
  import { page } from '$app/stores'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { ShieldPlus, Users, Clock3 } from 'lucide-svelte'
  import {
    MAX_TEAM_AVERAGE,
    MIN_TEAM_PLAYERS,
    TEAM_BALANCE_RANKS,
    computeTopFiveAverage,
    getRankValue,
  } from '$lib/team-balance'

  const MAX_TEAM_PLAYERS = 8

  type SubmissionRow = {
    id: string
    name: string
    tag: string | null
    approval_status: string
    approval_notes?: string | null
  }

  type RegisteredPlayer = {
    profile_id: string
    riot_id: string
    rank_label: string
    display_name: string | null
    email: string | null
  }

  type TeamInvite = {
    id: string
    status: string
    teams?:
      | {
          id: string
          name: string
          tag: string | null
          approval_status: string
          logo_path: string | null
        }[]
      | null
  }

  let { data } = $props()
  const user = $derived($page.data.user)
  const hasActiveMembership = $derived(Boolean(data.hasActiveMembership))

  const getInitialMySubmissions = () => data.mySubmissions ?? []
  const getInitialRegisteredPlayers = () => data.registeredPlayers ?? []
  const getInitialInvites = () => data.invites ?? []

  let mySubmissions = $state<SubmissionRow[]>(getInitialMySubmissions())
  let registeredPlayers = $state<RegisteredPlayer[]>(getInitialRegisteredPlayers())
  let invites = $state<TeamInvite[]>(getInitialInvites())

  let name = $state('')
  let tag = $state('')
  let headCoachName = $state('')
  let assistantCoachName = $state('')
  let logoPath = $state('')
  let logoPreviewUrl = $state('')
  let logoFile = $state<File | null>(null)
  let isUploadingLogo = $state(false)
  let isSubmitting = $state(false)
  let processingInviteId = $state<string | null>(null)
  let message = $state<{ type: 'success' | 'error'; text: string } | null>(null)

  type RosterEntry = {
    query: string
    profileId: string | null
  }

  let roster = $state<RosterEntry[]>(
    Array.from({ length: MIN_TEAM_PLAYERS }, () => ({ query: '', profileId: null }))
  )
  let activeRosterIndex = $state<number | null>(null)

  const playerSearchOptions = $derived(
    registeredPlayers.map((player) => ({
      profileId: player.profile_id,
      label: `${player.display_name || player.email || 'Unknown'} - ${player.riot_id}`,
      rank: player.rank_label,
    }))
  )

  function filteredOptionsForSlot(index: number, query: string) {
    const search = query.trim().toLowerCase()
    const takenByOtherSlots = new Set(
      roster
        .map((entry, idx) => (idx === index ? null : entry.profileId))
        .filter((id): id is string => Boolean(id))
    )

    return playerSearchOptions
      .filter((option) => !takenByOtherSlots.has(option.profileId))
      .filter((option) => {
        if (!search) return true
        return option.label.toLowerCase().includes(search)
      })
      .slice(0, 8)
  }

  function selectedPlayerForSlot(slot: RosterEntry) {
    if (!slot.profileId) return null
    return registeredPlayers.find((player) => player.profile_id === slot.profileId) ?? null
  }

  function addRosterPlayer() {
    if (roster.length >= MAX_TEAM_PLAYERS) return
    roster = [...roster, { query: '', profileId: null }]
  }

  function removeRosterPlayer(index: number) {
    if (roster.length <= MIN_TEAM_PLAYERS) return
    roster = roster.filter((_, idx) => idx !== index)
  }

  function updateRosterSearch(index: number, value: string) {
    const matchedOption = playerSearchOptions.find((option) => option.label === value)
    roster = roster.map((entry, idx) =>
      idx === index
        ? {
            query: value,
            profileId: matchedOption?.profileId ?? null,
          }
        : entry
    )
  }

  function selectRosterPlayer(index: number, profileId: string, label: string) {
    roster = roster.map((entry, idx) =>
      idx === index
        ? {
            query: label,
            profileId,
          }
        : entry
    )
    activeRosterIndex = null
  }

  function closeRosterSuggestions(event: MouseEvent) {
    const target = event.target as HTMLElement | null
    if (!target || !target.closest('[data-roster-search-slot]')) {
      activeRosterIndex = null
    }
  }

  const selectedRosterPlayers = $derived(
    roster
      .map((entry) => selectedPlayerForSlot(entry))
      .filter((player): player is RegisteredPlayer => player !== null)
  )

  const hasDuplicatePlayers = $derived(
    new Set(selectedRosterPlayers.map((player) => player.profile_id)).size !==
      selectedRosterPlayers.length
  )

  const topFiveAverage = $derived(
    computeTopFiveAverage(selectedRosterPlayers.map((player) => player.rank_label))
  )
  const previewRosterPlayers = $derived(
    roster
      .map((entry, idx) => {
        if (entry.profileId) {
          return selectedPlayerForSlot(entry)
        }

        const options = filteredOptionsForSlot(idx, entry.query)
        if (entry.query.trim().length > 0 && options.length === 1) {
          return (
            registeredPlayers.find((player) => player.profile_id === options[0].profileId) ?? null
          )
        }

        return null
      })
      .filter((player): player is RegisteredPlayer => player !== null)
  )
  const previewTopFiveAverage = $derived(
    computeTopFiveAverage(previewRosterPlayers.map((player) => player.rank_label))
  )
  const myTeams = $derived.by(() => {
    const created = mySubmissions.map((submission) => ({
      id: `created-${submission.id}`,
      teamId: submission.id,
      teamName: submission.name,
      teamTag: submission.tag,
      source: 'created' as const,
      status: approvalLabel(submission.approval_status),
      statusTone:
        submission.approval_status === 'approved'
          ? 'approved'
          : submission.approval_status === 'rejected'
            ? 'rejected'
            : 'pending',
      approvalStatus: submission.approval_status,
      approvalNotes: submission.approval_notes ?? null,
    }))

    const invited = invites.map((invite) => {
      const team = invite.teams?.[0]
      const approvalStatus = team?.approval_status ?? 'pending'
      const inviteStatus = invite.status

      let status = 'Pending'
      let statusTone: 'approved' | 'rejected' | 'pending' = 'pending'

      if (approvalStatus === 'approved' && inviteStatus === 'accepted') {
        status = 'Approved - Accepted'
        statusTone = 'approved'
      } else if (inviteStatus === 'accepted') {
        status = 'Accepted - Awaiting Approval'
      } else if (inviteStatus === 'pending') {
        status = 'Invite Pending'
      }

      return {
        id: `invite-${invite.id}`,
        inviteId: invite.id,
        inviteStatus,
        teamName: team?.name ?? 'Unknown Team',
        teamTag: team?.tag ?? null,
        source: 'invited' as const,
        status,
        statusTone,
      }
    })

    return [...created, ...invited]
  })

  let resubmittingTeamId = $state<string | null>(null)

  async function resubmitTeam(teamId: string) {
    resubmittingTeamId = teamId
    message = null
    try {
      const response = await fetch(`/api/teams/${teamId}/resubmit`, { method: 'POST' })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Failed to resubmit team')

      mySubmissions = mySubmissions.map((t) => (t.id === teamId ? result.team : t))
      message = { type: 'success', text: 'Team resubmitted. Admin review is required.' }
    } catch (err) {
      message = { type: 'error', text: err instanceof Error ? err.message : 'Unexpected error' }
    } finally {
      resubmittingTeamId = null
    }
  }
  const previewCurrentAverage = $derived.by(() => {
    if (previewRosterPlayers.length === 0) return null
    const total = previewRosterPlayers.reduce(
      (sum, player) => sum + getRankValue(player.rank_label),
      0
    )
    return total / previewRosterPlayers.length
  })
  const isRosterEligible = $derived(
    selectedRosterPlayers.length >= MIN_TEAM_PLAYERS &&
      selectedRosterPlayers.length <= MAX_TEAM_PLAYERS &&
      !hasDuplicatePlayers &&
      topFiveAverage <= MAX_TEAM_AVERAGE
  )

  function onLogoFileChange(event: Event) {
    const target = event.currentTarget as HTMLInputElement
    logoFile = target.files?.[0] ?? null
  }

  async function uploadLogo() {
    if (!logoFile) {
      message = { type: 'error', text: 'Choose a logo file first.' }
      return
    }

    isUploadingLogo = true
    message = null
    try {
      const payload = new FormData()
      payload.set('file', logoFile)

      const response = await fetch('/api/teams/logo', {
        method: 'POST',
        body: payload,
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.message || 'Failed to upload logo')
      }

      logoPath = result.path
      logoPreviewUrl = result.publicUrl
      message = { type: 'success', text: 'Logo uploaded. You can now submit the team draft.' }
    } catch (err) {
      message = { type: 'error', text: err instanceof Error ? err.message : 'Unexpected error' }
    } finally {
      isUploadingLogo = false
    }
  }

  async function createTeam() {
    isSubmitting = true
    message = null

    try {
      const response = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          tag: tag.toUpperCase(),
          logoPath,
          headCoachName,
          assistantCoachName,
          roster: selectedRosterPlayers.map((player) => ({
            profileId: player.profile_id,
          })),
        }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.message || 'Failed to create team draft')
      }

      mySubmissions = [result.team, ...mySubmissions]
      name = ''
      tag = ''
      headCoachName = ''
      assistantCoachName = ''
      logoPath = ''
      logoPreviewUrl = ''
      logoFile = null
      roster = Array.from({ length: MIN_TEAM_PLAYERS }, () => ({ query: '', profileId: null }))
      message = { type: 'success', text: 'Team draft submitted. Admin review is required.' }
    } catch (err) {
      message = { type: 'error', text: err instanceof Error ? err.message : 'Unexpected error' }
    } finally {
      isSubmitting = false
    }
  }

  async function respondToInvite(inviteId: string, action: 'accept' | 'decline') {
    processingInviteId = inviteId
    message = null
    try {
      const response = await fetch('/api/teams/invites', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteId, action }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.message || 'Failed to update invite')
      }

      invites = invites.map((invite) =>
        invite.id === inviteId ? { ...invite, status: result.status } : invite
      )
      message = {
        type: 'success',
        text:
          action === 'accept'
            ? 'Invite accepted. You will officially join when the team is approved.'
            : 'Invite declined.',
      }
    } catch (err) {
      message = { type: 'error', text: err instanceof Error ? err.message : 'Unexpected error' }
    } finally {
      processingInviteId = null
    }
  }

  function approvalLabel(status: string) {
    if (status === 'approved') return 'Approved'
    if (status === 'rejected') return 'Rejected'
    return 'Pending Review'
  }
</script>

<svelte:window onclick={closeRosterSuggestions} />

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-6xl">
      <div class="mb-8 flex flex-col items-center">
        <Users size={48} class="mb-4" style="color: var(--text);" />
        <h1 class="responsive-title mb-2 text-center">Team Registration</h1>
        <p class="responsive-text mb-6 text-center" style="color: var(--text);">
          Submit your team for admin approval and manage player invites.
        </p>
      </div>

      <div class="grid grid-cols-1 gap-4">
        <section class="info-card info-card-surface mx-auto w-full max-w-3xl">
          <h2 class="mb-3 flex items-center gap-2 text-lg font-bold" style="color: var(--title);">
            <ShieldPlus size={18} />
            <span>Create Team Draft</span>
          </h2>
          {#if !user}
            <p class="text-sm" style="color: rgba(255, 255, 255, 0.72);">
              Log in to submit a team.
            </p>
          {:else}
            <form
              onsubmit={(e) => {
                e.preventDefault()
                if (hasActiveMembership) return
                createTeam()
              }}
              class="flex flex-col gap-3"
            >
              {#if hasActiveMembership}
                <div
                  class="rounded-md border px-3 py-2 text-sm"
                  style="border-color: rgba(250, 204, 21, 0.35); background: rgba(250, 204, 21, 0.12); color: #fde68a;"
                >
                  You already have an active team membership. You cannot create another team.
                </div>
              {/if}

              <input
                bind:value={name}
                placeholder="Team Name"
                required
                minlength="2"
                maxlength="48"
                class="rounded-md border px-3 py-2"
                style="border-color: rgba(255, 255, 255, 0.18); background: rgba(0, 0, 0, 0.25); color: var(--text);"
              />
              <input
                bind:value={tag}
                placeholder="Tag (2-4 letters)"
                maxlength="4"
                minlength="2"
                required
                class="rounded-md border px-3 py-2"
                style="border-color: rgba(255, 255, 255, 0.18); background: rgba(0, 0, 0, 0.25); color: var(--text);"
              />
              <p class="-mt-1 text-xs" style="color: rgba(255,255,255,0.65);">
                Team tag is required and must be 2-4 letters.
              </p>

              <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  bind:value={headCoachName}
                  placeholder="Head Coach (optional)"
                  maxlength="48"
                  class="rounded-md border px-3 py-2"
                  style="border-color: rgba(255, 255, 255, 0.18); background: rgba(0, 0, 0, 0.25); color: var(--text);"
                />
                <input
                  bind:value={assistantCoachName}
                  placeholder="Assistant Coach (optional)"
                  maxlength="48"
                  class="rounded-md border px-3 py-2"
                  style="border-color: rgba(255, 255, 255, 0.18); background: rgba(0, 0, 0, 0.25); color: var(--text);"
                />
              </div>

              <div class="rounded-lg border p-3" style="border-color: rgba(255,255,255,0.18);">
                <div class="mb-2 text-sm font-semibold" style="color: var(--title);">
                  Team Roster ({MIN_TEAM_PLAYERS} to {MAX_TEAM_PLAYERS} players)
                </div>
                <p class="mb-2 text-xs" style="color: rgba(255,255,255,0.7);">
                  Team limit is 10 total people: up to 8 players plus optional Head Coach and
                  Assistant Coach.
                </p>

                {#if registeredPlayers.length === 0}
                  <div
                    class="rounded-md border p-3 text-sm"
                    style="border-color: rgba(248,113,113,0.25); color: #f87171;"
                  >
                    No ranked players found yet. Players must complete signup and wait for admin
                    rank assignment.
                  </div>
                {/if}

                <div class="space-y-2">
                  {#each roster as entry, idx}
                    <div
                      class="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]"
                      data-roster-search-slot
                    >
                      <div class="relative">
                        <input
                          value={entry.query}
                          onfocus={() => (activeRosterIndex = idx)}
                          oninput={(e) => {
                            activeRosterIndex = idx
                            updateRosterSearch(idx, e.currentTarget.value)
                          }}
                          placeholder={`Search player slot ${idx + 1}`}
                          class="w-full rounded-md border px-3 py-2"
                          style="border-color: rgba(255, 255, 255, 0.18); background: rgba(0, 0, 0, 0.25); color: var(--text);"
                        />

                        {#if activeRosterIndex === idx && filteredOptionsForSlot(idx, entry.query).length > 0}
                          <div
                            class="absolute z-20 mt-1 max-h-44 w-full overflow-y-auto rounded-md border p-1"
                            style="border-color: rgba(255,255,255,0.2); background: rgba(15,15,22,0.97);"
                          >
                            {#each filteredOptionsForSlot(idx, entry.query) as option}
                              <button
                                type="button"
                                class="block w-full rounded px-2 py-1 text-left text-xs hover:bg-white/10"
                                style="color: var(--text);"
                                onmousedown={(e) => {
                                  e.preventDefault()
                                  selectRosterPlayer(idx, option.profileId, option.label)
                                }}
                              >
                                {option.label}
                                <span class="ml-2 opacity-70">{option.rank}</span>
                              </button>
                            {/each}
                          </div>
                        {/if}
                      </div>
                      <input
                        value={selectedPlayerForSlot(entry)?.rank_label ?? ''}
                        placeholder="Auto rank (admin-assigned)"
                        readonly
                        disabled
                        tabindex="-1"
                        class="rounded-md border px-3 py-2"
                        style="border-color: rgba(255, 255, 255, 0.12); background: rgba(0, 0, 0, 0.18); color: rgba(255,255,255,0.72); cursor: not-allowed;"
                      />
                      <button
                        type="button"
                        class="rounded-md px-3 py-2 text-sm"
                        style="background: rgba(248,113,113,0.18); color: #f87171;"
                        onclick={() => removeRosterPlayer(idx)}
                        disabled={roster.length <= MIN_TEAM_PLAYERS}
                      >
                        Remove
                      </button>
                    </div>
                  {/each}
                </div>

                <div class="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    class="rounded-md px-3 py-2 text-sm font-semibold"
                    style="background: rgba(255,255,255,0.12); color: var(--text);"
                    onclick={addRosterPlayer}
                    disabled={roster.length >= MAX_TEAM_PLAYERS}
                  >
                    Add Player
                  </button>
                  <span class="text-xs" style="color: rgba(255,255,255,0.75);">
                    Current average: {previewCurrentAverage !== null
                      ? previewCurrentAverage.toFixed(2)
                      : 'N/A'} / {MAX_TEAM_AVERAGE}
                  </span>
                  {#if hasDuplicatePlayers}
                    <span class="text-xs font-semibold" style="color: #f87171;">
                      Duplicate players selected.
                    </span>
                  {/if}
                  <span
                    class="rounded-full px-2 py-1 text-xs font-bold"
                    style={isRosterEligible
                      ? 'background: rgba(74,222,128,0.2); color: #4ade80;'
                      : 'background: rgba(248,113,113,0.2); color: #f87171;'}
                  >
                    {isRosterEligible ? 'Eligible' : 'Not Eligible'}
                  </span>
                </div>
              </div>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                class="rounded-md border px-3 py-2"
                style="border-color: rgba(255, 255, 255, 0.18); background: rgba(0, 0, 0, 0.25); color: var(--text);"
                onchange={onLogoFileChange}
              />
              <button
                type="button"
                class="w-fit rounded-md px-3 py-2 text-sm font-semibold"
                style="background: rgba(255,255,255,0.12); color: var(--text);"
                onclick={uploadLogo}
                disabled={isUploadingLogo}
              >
                {isUploadingLogo ? 'Uploading...' : 'Upload Logo'}
              </button>

              {#if logoPreviewUrl}
                <div
                  class="flex items-center gap-3 rounded-md border p-2"
                  style="border-color: rgba(255,255,255,0.18);"
                >
                  <img
                    src={logoPreviewUrl}
                    alt="Uploaded logo preview"
                    class="h-12 w-12 rounded object-contain"
                  />
                  <div class="text-xs" style="color: rgba(255,255,255,0.75);">
                    <div>Uploaded logo ready for submission.</div>
                    <div class="truncate">{logoPath}</div>
                  </div>
                </div>
              {/if}

              {#if message}
                <div
                  class="rounded-md p-2 text-sm"
                  style={message.type === 'success'
                    ? 'color: #4ade80; background: rgba(74, 222, 128, 0.2);'
                    : 'color: #f87171; background: rgba(248, 113, 113, 0.2);'}
                >
                  {message.text}
                </div>
              {/if}

              <button
                type="submit"
                disabled={isSubmitting || !isRosterEligible || !logoPath || hasActiveMembership}
                class="rounded-md px-4 py-2 font-bold transition-opacity disabled:cursor-not-allowed disabled:opacity-65"
                style="background: var(--accent); color: var(--text);"
              >
                {isSubmitting ? 'Submitting...' : 'Submit Team Draft'}
              </button>
            </form>

            {#if myTeams.length > 0}
              <div class="mt-4 flex flex-col gap-2">
                <h3
                  class="mb-1 flex items-center gap-2 text-sm font-semibold"
                  style="color: var(--title);"
                >
                  <Clock3 size={16} />
                  <span>My Teams</span>
                </h3>
                {#each myTeams as item}
                  <article
                    class="flex justify-between gap-3 rounded-lg border px-3 py-2"
                    style="border-color: rgba(255, 255, 255, 0.12); background: rgba(0, 0, 0, 0.2);"
                  >
                    <div class="min-w-0">
                      <strong>{item.teamName}</strong>
                      {#if item.teamTag}
                        <span> [{item.teamTag}]</span>
                      {/if}
                      {#if item.source === 'invited'}
                        <span
                          class="ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                          style="background: rgba(59,130,246,0.2); color: #93c5fd;"
                        >
                          Invited
                        </span>
                      {:else}
                        <span
                          class="ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                          style="background: rgba(255,255,255,0.14); color: rgba(255,255,255,0.8);"
                        >
                          Created
                        </span>
                      {/if}

                      {#if item.source === 'created' && item.approvalStatus === 'rejected' && item.approvalNotes}
                        <div class="mt-1 text-xs" style="color: rgba(255,255,255,0.72);">
                          Admin notes: {item.approvalNotes}
                        </div>
                      {/if}
                    </div>
                    <div class="flex items-center gap-2">
                      <span
                        class="self-center rounded-full px-2 py-1 text-xs font-bold"
                        style={item.statusTone === 'approved'
                          ? 'background: rgba(74, 222, 128, 0.2); color: #4ade80;'
                          : item.statusTone === 'rejected'
                            ? 'background: rgba(248, 113, 113, 0.2); color: #f87171;'
                            : 'background: rgba(250, 204, 21, 0.18); color: #facc15;'}
                      >
                        {item.status}
                      </span>

                      {#if item.source === 'created' && item.approvalStatus === 'rejected' && item.teamId}
                        <button
                          type="button"
                          class="rounded-md px-2 py-1 text-xs font-semibold"
                          style="background: rgba(250, 204, 21, 0.18); color: #fde68a;"
                          disabled={resubmittingTeamId === item.teamId}
                          onclick={() => resubmitTeam(item.teamId)}
                        >
                          {resubmittingTeamId === item.teamId ? 'Resubmitting...' : 'Resubmit'}
                        </button>
                      {/if}

                      {#if item.source === 'invited' && item.inviteStatus === 'pending' && item.inviteId}
                        <button
                          type="button"
                          class="rounded-md px-2 py-1 text-xs font-semibold"
                          style="background: rgba(74, 222, 128, 0.2); color: #4ade80;"
                          disabled={processingInviteId === item.inviteId}
                          onclick={() => respondToInvite(item.inviteId, 'accept')}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          class="rounded-md px-2 py-1 text-xs font-semibold"
                          style="background: rgba(248, 113, 113, 0.2); color: #f87171;"
                          disabled={processingInviteId === item.inviteId}
                          onclick={() => respondToInvite(item.inviteId, 'decline')}
                        >
                          Decline
                        </button>
                      {/if}
                    </div>
                  </article>
                {/each}
              </div>
            {/if}
          {/if}
        </section>
      </div>
    </div>
  </div>
</PageContainer>
