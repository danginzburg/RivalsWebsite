<script lang="ts">
  import { page } from '$app/stores'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { Users, Wrench } from 'lucide-svelte'

  let { data } = $props() as { data: any }

  const team = $derived(data.team)
  const roster = $derived(data.roster ?? [])
  const invitedPlayers = $derived(data.invitedPlayers ?? [])
  const matchHistory = $derived(data.matchHistory ?? [])
  const viewer = $derived(data.viewer ?? { isAdmin: false, membershipRole: null })
  const user = $derived($page.data.user)

  const isCaptainLike = $derived(
    viewer.membershipRole === 'captain' || viewer.membershipRole === 'manager'
  )

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
        {#if user?.role === 'admin' || isCaptainLike}
          <div
            class="mb-4 rounded-md border p-3"
            style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
          >
            <div
              class="mb-2 flex items-center gap-2 text-sm font-semibold"
              style="color: var(--title);"
            >
              <Wrench size={16} />
              <span>Captain Tools</span>
            </div>
            <div class="flex flex-wrap gap-2">
              <a
                href="/captain/matches"
                class="rounded-md px-3 py-2 text-xs font-semibold"
                style="background: rgba(59,130,246,0.2); color: #93c5fd;"
              >
                Match Proposals
              </a>
            </div>
          </div>
        {/if}

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
                  <th class="px-2 py-2">Riot ID</th>
                  <th class="px-2 py-2">Role</th>
                  <th class="px-2 py-2">Rank</th>
                  <th class="px-2 py-2">Discord</th>
                </tr>
              </thead>
              <tbody>
                {#each roster as player}
                  <tr class="border-b" style="border-color: rgba(255,255,255,0.08);">
                    <td class="px-2 py-2 font-semibold" style="color: var(--text);">
                      <a
                        href={`/players/${player.profile_id}`}
                        class="underline"
                        style="color: var(--text);">{player.riot_id}</a
                      >
                    </td>
                    <td class="px-2 py-2" style="color: var(--text);">{player.role}</td>
                    <td class="px-2 py-2" style="color: var(--text);"
                      >{player.rank_label ?? 'Unranked'}</td
                    >
                    <td class="px-2 py-2" style="color: var(--text);">{profileLabel(player)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

        {#if invitedPlayers.length > 0}
          <div class="mt-6">
            <h3
              class="mb-2 text-sm font-semibold tracking-wide uppercase"
              style="color: rgba(255,255,255,0.72);"
            >
              Pending Invites
            </h3>
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm opacity-70">
                <thead>
                  <tr
                    class="border-b"
                    style="border-color: rgba(255,255,255,0.12); color: rgba(255,255,255,0.75);"
                  >
                    <th class="px-2 py-2">Riot ID</th>
                    <th class="px-2 py-2">Rank</th>
                    <th class="px-2 py-2">Discord</th>
                    <th class="px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {#each invitedPlayers as player}
                    <tr class="border-b" style="border-color: rgba(255,255,255,0.08);">
                      <td class="px-2 py-2 font-semibold" style="color: var(--text);">
                        <a
                          href={`/players/${player.profile_id}`}
                          class="underline"
                          style="color: var(--text);">{player.riot_id}</a
                        >
                      </td>
                      <td class="px-2 py-2" style="color: var(--text);"
                        >{player.rank_label ?? 'Unranked'}</td
                      >
                      <td class="px-2 py-2" style="color: var(--text);">{profileLabel(player)}</td>
                      <td class="px-2 py-2">
                        <span
                          class="rounded-full px-2 py-1 text-xs font-semibold"
                          style={player.status === 'accepted'
                            ? 'background: rgba(74,222,128,0.18); color: #86efac;'
                            : 'background: rgba(250,204,21,0.18); color: #fde68a;'}
                        >
                          {player.status === 'accepted'
                            ? 'Accepted (awaiting finalization)'
                            : 'Not accepted yet'}
                        </span>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
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
                    <th class="px-2 py-2">Participants</th>
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
                      <td class="px-2 py-2" style="color: var(--text);">
                        {#if (match.participants ?? []).length === 0}
                          <span style="color: rgba(255,255,255,0.7);">—</span>
                        {:else}
                          {(match.participants ?? []).join(', ')}
                        {/if}
                      </td>
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
