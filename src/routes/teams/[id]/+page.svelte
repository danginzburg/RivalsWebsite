<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { Users } from 'lucide-svelte'

  let { data } = $props() as { data: any }

  const team = $derived(data.team)
  const roster = $derived(data.roster ?? [])
  const matchHistory = $derived(data.matchHistory ?? [])
  const viewer = $derived(data.viewer ?? { isAdmin: false })

  let playerPool = $state<any[]>([])
  let isLoadingPlayerPool = $state(false)
  let addProfileId = $state('')
  let addRole = $state('player')
  let editError = $state<string | null>(null)

  const membershipRoleOptions = [
    { value: 'player', label: 'Player' },
    { value: 'captain', label: 'Captain' },
    { value: 'substitute', label: 'Substitute' },
    { value: 'coach', label: 'Coach' },
    { value: 'manager', label: 'Manager' },
  ]

  const playerOptions = $derived.by(() => {
    return (playerPool ?? [])
      .filter((u) => u.role !== 'banned' && u.role !== 'restricted')
      .map((p) => {
        const labelParts = [p.riot_id_base || p.display_name || p.email || p.id]
        if (p.riot_id_base && p.display_name && p.display_name !== p.riot_id_base) {
          labelParts.push(p.display_name)
        }
        return { value: p.id, label: labelParts.filter(Boolean).join(' - ') }
      })
  })

  function profileLabel(
    entry:
      | { display_name?: string | null; email?: string | null }
      | { display_name?: string | null; email?: string | null }[]
      | null
      | undefined
  ) {
    if (!entry) return '—'
    if (Array.isArray(entry)) {
      const first = entry[0]
      return first?.display_name || first?.email || '—'
    }
    return entry.display_name || entry.email || '—'
  }

  function formatUtc(value: string | null | undefined) {
    if (!value) return 'Date TBD'
    const date = new Date(value)
    return `${date.toLocaleString(undefined, { timeZone: 'UTC' })} UTC`
  }

  function teamName(value: unknown) {
    if (!value) return 'Team'
    if (Array.isArray(value)) return (value[0] as { name?: string } | undefined)?.name ?? 'Team'
    return (value as { name?: string }).name ?? 'Team'
  }

  function opponentFor(match: any, teamId: string) {
    return match?.team_a_id === teamId ? match?.team_b : match?.team_a
  }

  function scoreFor(match: any, teamId: string) {
    const a = Number(match?.team_a_score ?? 0)
    const b = Number(match?.team_b_score ?? 0)
    if (match?.team_a_id === teamId) return { us: a, them: b }
    return { us: b, them: a }
  }

  async function loadPlayerPool() {
    if (isLoadingPlayerPool) return
    isLoadingPlayerPool = true
    try {
      const res = await fetch('/api/admin/users')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.message ?? 'Failed to load users')
      playerPool = body.users ?? []
    } catch (err) {
      editError = err instanceof Error ? err.message : 'Failed to load users'
    } finally {
      isLoadingPlayerPool = false
    }
  }

  async function addPlayer() {
    editError = null
    if (!addProfileId) {
      editError = 'Select a user'
      return
    }
    try {
      const res = await fetch('/api/admin/teams/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: team.id, profileId: addProfileId, role: addRole }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.message ?? 'Failed to add user')
      window.location.reload()
    } catch (err) {
      editError = err instanceof Error ? err.message : 'Failed to add user'
    }
  }

  async function removePlayer(profileId: string) {
    const confirmed = window.confirm('Remove this user from the team?')
    if (!confirmed) return
    editError = null
    try {
      const res = await fetch('/api/admin/teams/manage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: team.id, profileId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.message ?? 'Failed to remove user')
      window.location.reload()
    } catch (err) {
      editError = err instanceof Error ? err.message : 'Failed to remove user'
    }
  }

  $effect(() => {
    if (viewer.isAdmin && playerPool.length === 0) loadPlayerPool()
  })
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-5xl">
      <div class="mb-6 flex flex-col items-center text-center">
        {#if team.logo_url}
          <img
            src={team.logo_url}
            alt="{team.name} logo"
            class="mb-3 h-16 w-16 rounded object-contain"
          />
        {:else}
          <Users size={48} class="mb-3" style="color: var(--text);" />
        {/if}
        <h1 class="responsive-title mb-2">{team.name}{team.tag ? ` [${team.tag}]` : ''}</h1>
      </div>

      <section class="info-card info-card-surface">
        <h2 class="mb-3 text-lg font-bold" style="color: var(--title);">Roster</h2>
        {#if roster.length === 0}
          <p class="text-sm" style="color: rgba(255,255,255,0.75);">No active roster listed.</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead>
                <tr
                  class="border-b"
                  style="border-color: rgba(255,255,255,0.12); color: rgba(255,255,255,0.75);"
                >
                  <th class="px-2 py-2">Name</th>
                  <th class="px-2 py-2">Role</th>
                  <th class="px-2 py-2">User</th>
                  {#if viewer.isAdmin}
                    <th class="px-2 py-2">Actions</th>
                  {/if}
                </tr>
              </thead>
              <tbody>
                {#each roster as player}
                  <tr class="border-b" style="border-color: rgba(255,255,255,0.08);">
                    <td class="px-2 py-2 font-semibold" style="color: var(--text);">
                      <a
                        href={`/players/${player.profile_id}`}
                        class="underline"
                        style="color: var(--text);"
                        >{player.riot_id_base ?? player.display_name ?? player.email ?? 'Player'}</a
                      >
                    </td>
                    <td class="px-2 py-2" style="color: var(--text);">{player.role}</td>
                    <td class="px-2 py-2" style="color: var(--text);">{profileLabel(player)}</td>
                    {#if viewer.isAdmin}
                      <td class="px-2 py-2">
                        <button
                          type="button"
                          class="rounded px-2 py-1 text-xs font-semibold"
                          style="background: rgba(248,113,113,0.2); color: #f87171;"
                          onclick={() => removePlayer(player.profile_id)}
                        >
                          Remove
                        </button>
                      </td>
                    {/if}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

        {#if viewer.isAdmin}
          <div
            class="mt-4 rounded-md border p-3"
            style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.18);"
          >
            <div
              class="mb-2 text-xs font-semibold tracking-wide uppercase"
              style="color: rgba(255,255,255,0.75);"
            >
              Admin: Edit Roster
            </div>

            {#if editError}
              <div
                class="mb-2 rounded-md border p-2 text-sm"
                style="border-color: rgba(248,113,113,0.35); background: rgba(248,113,113,0.08); color: #fecaca;"
              >
                {editError}
              </div>
            {/if}

            <div class="grid grid-cols-1 gap-2 md:grid-cols-3">
              <div class="md:col-span-2">
                <CustomSelect
                  options={playerOptions}
                  value={addProfileId}
                  placeholder={isLoadingPlayerPool ? 'Loading users...' : 'Select user'}
                  compact={true}
                  disabled={isLoadingPlayerPool}
                  onSelect={(value) => (addProfileId = value)}
                />
              </div>
              <div>
                <CustomSelect
                  options={membershipRoleOptions}
                  value={addRole}
                  placeholder="Role"
                  compact={true}
                  onSelect={(value) => (addRole = value)}
                />
              </div>
            </div>

            <div class="mt-2 flex justify-end">
              <button
                type="button"
                class="rounded px-2 py-1 text-xs font-semibold"
                style="background: rgba(74,222,128,0.2); color: #4ade80;"
                onclick={addPlayer}
                disabled={isLoadingPlayerPool}
              >
                Add
              </button>
            </div>
          </div>
        {/if}

        <div class="mt-8">
          <h2 class="mb-3 text-lg font-bold" style="color: var(--title);">Match History</h2>

          {#if matchHistory.length === 0}
            <p class="text-sm" style="color: rgba(255,255,255,0.75);">No completed matches yet.</p>
          {:else}
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead>
                  <tr
                    class="border-b"
                    style="border-color: rgba(255,255,255,0.12); color: rgba(255,255,255,0.75);"
                  >
                    <th class="px-2 py-2">Match</th>
                    <th class="px-2 py-2">When</th>
                    <th class="px-2 py-2">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {#each matchHistory as match}
                    {@const opp = opponentFor(match, team.id)}
                    {@const score = scoreFor(match, team.id)}
                    <tr class="border-b" style="border-color: rgba(255,255,255,0.08);">
                      <td class="px-2 py-2 font-semibold" style="color: var(--text);">
                        <a
                          href={`/matches/${match.id}`}
                          class="underline"
                          style="color: var(--text);">vs {teamName(opp)}</a
                        >
                      </td>
                      <td class="px-2 py-2" style="color: var(--text);"
                        >{formatUtc(match.ended_at ?? match.scheduled_at)}</td
                      >
                      <td class="px-2 py-2" style="color: var(--text);">{score.us}-{score.them}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      </section>
    </div>
  </div>
</PageContainer>
