<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { Trophy } from 'lucide-svelte'

  let { data } = $props() as { data: any }

  const rows = $derived((data.rows ?? []) as any[])
  const batch = $derived(data.batch ?? null)
  function teamLabel(team: any) {
    return team?.name ?? 'Team'
  }
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-6xl">
      <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <Trophy size={36} style="color: var(--text);" />
          <div>
            <h1 class="responsive-title">Leaderboard</h1>
            <p class="text-sm" style="color: rgba(255,255,255,0.72);">
              Showing the most recently imported standings.
            </p>
            {#if batch}
              <p class="mt-1 text-xs" style="color: rgba(255,255,255,0.58);">
                {batch.display_name}
                {#if batch.as_of_date}
                  <span> • As of {batch.as_of_date}</span>
                {/if}
              </p>
            {/if}
          </div>
        </div>
      </div>

      {#if rows.length === 0}
        <div
          class="inline-flex w-fit self-center rounded-md border px-3 py-2"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
        >
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">No leaderboard data yet.</p>
        </div>
      {:else}
        <div
          class="overflow-x-auto rounded-md border"
          style="border-color: rgba(255,255,255,0.12);"
        >
          <table class="min-w-full text-left text-sm">
            <thead>
              <tr class="text-xs tracking-wide uppercase" style="color: rgba(255,255,255,0.75);">
                <th class="px-3 py-2">Rank</th>
                <th class="px-3 py-2">Team</th>
                <th class="px-3 py-2"># Series</th>
                <th class="px-3 py-2">Series Wins</th>
                <th class="px-3 py-2">Series Losses</th>
                <th class="px-3 py-2"># Maps</th>
                <th class="px-3 py-2">Map Wins</th>
                <th class="px-3 py-2">Map Losses</th>
                <th class="px-3 py-2">Round Diff.</th>
              </tr>
            </thead>
            <tbody>
              {#each rows as row, i}
                <tr class="border-t" style="border-color: rgba(255,255,255,0.10);">
                  <td class="px-3 py-2" style="color: rgba(255,255,255,0.82);"
                    >{row.rank || i + 1}</td
                  >
                  <td class="px-3 py-2" style="color: var(--text);">
                    <div class="flex items-center gap-2">
                      {#if row.team?.logo_url}
                        <img
                          src={row.team.logo_url}
                          alt="Team logo"
                          class="h-6 w-6 rounded-sm object-contain"
                        />
                      {:else}
                        <div
                          class="h-6 w-6 rounded-sm border"
                          style="border-color: rgba(255,255,255,0.15);"
                        ></div>
                      {/if}
                      {#if row.team?.tag}
                        <span style="color: rgba(255,255,255,0.72);"
                          >[{String(row.team.tag).toUpperCase()}]</span
                        >
                      {/if}
                      <a
                        href={row.team?.id ? `/teams/${row.team.id}` : '/teams'}
                        class="font-semibold underline"
                        style="color: var(--text);"
                      >
                        {teamLabel(row.team)}
                      </a>
                    </div>
                  </td>
                  <td class="px-3 py-2" style="color: rgba(255,255,255,0.82);"
                    >{row.series_played}</td
                  >
                  <td class="px-3 py-2" style="color: rgba(255,255,255,0.82);">{row.series_wins}</td
                  >
                  <td class="px-3 py-2" style="color: rgba(255,255,255,0.82);"
                    >{row.series_losses}</td
                  >
                  <td class="px-3 py-2" style="color: rgba(255,255,255,0.82);">{row.maps_played}</td
                  >
                  <td class="px-3 py-2" style="color: rgba(255,255,255,0.82);">{row.map_wins}</td>
                  <td class="px-3 py-2" style="color: rgba(255,255,255,0.82);">{row.map_losses}</td>
                  <td class="px-3 py-2" style="color: rgba(255,255,255,0.82);">{row.round_diff}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </div>
</PageContainer>
