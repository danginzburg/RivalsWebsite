<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { Users } from 'lucide-svelte'

  let { data }: PageProps = $props()
  const teams = $derived(data.teams ?? [])
  const myTeam = $derived(data.myTeam ?? null)
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-6xl space-y-6">
      <div class="flex items-center gap-3">
        <Users size={36} style="color: var(--text);" />
        <div>
          <h1 class="responsive-title">Teams</h1>
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">All the teams in one place!</p>
        </div>
      </div>

      {#if myTeam}
        <a
          href={`/teams/${myTeam.id}`}
          class="flex items-center justify-between gap-3 rounded-lg border p-4 transition-colors hover:bg-white/5"
          style="border-color: rgba(59,130,246,0.24); background: rgba(59,130,246,0.10);"
        >
          <div class="flex items-center gap-3">
            {#if myTeam.logo_url}
              <img
                src={myTeam.logo_url}
                alt="{myTeam.name} logo"
                class="h-12 w-12 rounded object-contain"
              />
            {/if}
            <div>
              <div class="text-xs tracking-wide uppercase" style="color: rgba(147,197,253,0.85);">
                Your Team
              </div>
              <div class="font-semibold" style="color: var(--text);">
                {myTeam.name}{myTeam.tag ? ` [${myTeam.tag}]` : ''}
              </div>
              <div class="text-sm" style="color: rgba(255,255,255,0.72);">
                Linked as {myTeam.role ?? 'member'}
              </div>
            </div>
          </div>
          <div class="text-sm font-semibold" style="color: #93c5fd;">Open Team Page</div>
        </a>
      {/if}

      {#if teams.length === 0}
        <div
          class="rounded-lg border p-4 text-sm"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2); color: rgba(255,255,255,0.72);"
        >
          No approved teams yet.
        </div>
      {:else}
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {#each teams as team}
            <a
              href={`/teams/${team.id}`}
              class="group rounded-lg border p-4 transition-colors duration-150 hover:bg-white/5"
              style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
            >
              <div class="flex items-center gap-2.5">
                {#if team.logo_url}
                  <img
                    src={team.logo_url}
                    alt="{team.name} logo"
                    class="h-12 w-12 rounded object-contain"
                  />
                {:else}
                  <div
                    class="flex h-12 w-12 items-center justify-center rounded border"
                    style="border-color: rgba(255,255,255,0.12);"
                  >
                    N/A
                  </div>
                {/if}
                <div class="min-w-0">
                  <div
                    class="truncate text-lg font-semibold transition-colors group-hover:text-[#93c5fd]"
                    style="color: var(--text);"
                  >
                    {team.name}
                  </div>
                  {#if team.tag}
                    <div class="mt-0.5 text-xs leading-none" style="color: rgba(255,255,255,0.68);">
                      [{team.tag}]
                    </div>
                  {/if}
                </div>
              </div>

              {#if team.about}
                <p class="mt-3 line-clamp-3 text-sm" style="color: rgba(255,255,255,0.78);">
                  {team.about}
                </p>
              {/if}

              {#if team.leaderboard}
                <div class="mt-2.5 grid grid-cols-3 gap-1.5 text-center text-xs">
                  <div
                    class="rounded-md border px-2 py-1.5"
                    style="border-color: rgba(255,255,255,0.10);"
                  >
                    <div style="color: rgba(255,255,255,0.6);">Rank</div>
                    <div
                      class="mt-0.5 text-sm leading-none font-semibold"
                      style="color: var(--text);"
                    >
                      #{team.leaderboard.rank}
                    </div>
                  </div>
                  <div
                    class="rounded-md border px-2 py-1.5"
                    style="border-color: rgba(255,255,255,0.10);"
                  >
                    <div style="color: rgba(255,255,255,0.6);">Points</div>
                    <div
                      class="mt-0.5 text-sm leading-none font-semibold"
                      style="color: var(--text);"
                    >
                      {team.leaderboard.points}
                    </div>
                  </div>
                  <div
                    class="rounded-md border px-2 py-1.5"
                    style="border-color: rgba(255,255,255,0.10);"
                  >
                    <div style="color: rgba(255,255,255,0.6);">Record</div>
                    <div
                      class="mt-0.5 text-sm leading-none font-semibold"
                      style="color: var(--text);"
                    >
                      {team.leaderboard.wins}-{team.leaderboard.losses}
                    </div>
                  </div>
                </div>
              {/if}

              <div class="mt-2.5 flex justify-end">
                <div
                  class="flex h-6 w-6 items-center justify-center rounded-full border text-sm font-semibold opacity-60 transition-opacity group-hover:opacity-100"
                  style="border-color: rgba(147,197,253,0.45); color: #93c5fd; background: rgba(59,130,246,0.10);"
                >
                  +
                </div>
              </div>
            </a>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</PageContainer>
