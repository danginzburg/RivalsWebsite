<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { Users } from 'lucide-svelte'

  let { data } = $props()

  const team = $derived(data.team)
  const roster = $derived(data.roster ?? [])

  function profileLabel(entry: { display_name: string | null; email: string | null }) {
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
        <p class="text-sm" style="color: rgba(255,255,255,0.75);">
          Created by {profileLabel(team.profiles?.[0] ?? { display_name: null, email: null })}
        </p>
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
                  <th class="px-2 py-2">Profile</th>
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
      </section>
    </div>
  </div>
</PageContainer>
