<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { Users } from 'lucide-svelte'

  let { data } = $props()

  const team = $derived(data.team)
  const roster = $derived(data.roster ?? [])
  const invitedPlayers = $derived(data.invitedPlayers ?? [])

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
                  <th class="px-2 py-2">Riot ID</th>
                  <th class="px-2 py-2">Role</th>
                  <th class="px-2 py-2">Rank</th>
                  <th class="px-2 py-2">Discord</th>
                </tr>
              </thead>
              <tbody>
                {#each roster as player}
                  <tr class="border-b" style="border-color: rgba(255,255,255,0.08);">
                    <td class="px-2 py-2 font-semibold" style="color: var(--text);"
                      >{player.riot_id}</td
                    >
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
                      <td class="px-2 py-2 font-semibold" style="color: var(--text);"
                        >{player.riot_id}</td
                      >
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
      </section>
    </div>
  </div>
</PageContainer>
