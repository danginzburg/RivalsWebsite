<script lang="ts">
  type Team = {
    id?: string | null
    name?: string | null
    tag?: string | null
    logo_url?: string | null
  }

  type Match = {
    id: string
    status: string
    best_of: number
    scheduled_at: string | null
    team_a: Team
    team_b: Team
    primary_stream_url?: string | null
    maps?: string[]
  }

  let { matches }: { matches: Match[] } = $props()

  function formatUtc(value: string | null | undefined) {
    if (!value) return 'Date TBD'
    const date = new Date(value)
    return `${date.toLocaleString(undefined, { timeZone: 'UTC' })} UTC`
  }

  function teamLabel(team: Team) {
    return team?.name ?? 'Team'
  }

  function teamTag(team: Team) {
    return (team?.tag ?? '').toString().toUpperCase()
  }
</script>

<div class="matches-section-wrapper">
  <div class="flex w-full max-w-5xl flex-col gap-4">
    {#if matches.length === 0}
      <div
        class="inline-flex w-fit self-center rounded-md border px-3 py-2"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <p class="text-sm" style="color: rgba(255,255,255,0.72);">
          There are no matches currently scheduled.
        </p>
      </div>
    {:else}
      {#each matches as match}
        <div class="info-card info-card-surface relative">
          <!-- Team matchup: stacked on mobile, horizontal on sm+ -->
          <div class="flex flex-col items-center gap-2 sm:flex-row sm:gap-4">
            <!-- Team A -->
            <div
              class="flex w-full min-w-0 flex-1 items-center justify-center gap-3 sm:justify-start"
            >
              {#if match.team_a?.logo_url}
                <img
                  src={match.team_a.logo_url}
                  alt="{teamTag(match.team_a)} logo"
                  class="h-8 w-8 rounded-sm object-contain"
                />
              {:else}
                <div
                  class="flex h-8 w-8 items-center justify-center rounded-sm border text-[10px] font-bold"
                  style="border-color: rgba(255,255,255,0.18); color: rgba(255,255,255,0.75); background: rgba(0,0,0,0.18);"
                >
                  {teamTag(match.team_a) || '—'}
                </div>
              {/if}
              <p class="truncate text-lg font-semibold" style="color: var(--title);">
                {teamLabel(match.team_a)}
              </p>
            </div>

            <!-- VS / BO3 indicator -->
            <div class="w-16 text-center">
              <p class="text-sm font-semibold" style="color: var(--text);">VS</p>
            </div>

            <!-- Team B -->
            <div
              class="flex w-full min-w-0 flex-1 items-center justify-center gap-3 sm:justify-end"
            >
              <p class="truncate text-lg font-semibold sm:order-1" style="color: var(--title);">
                {teamLabel(match.team_b)}
              </p>
              {#if match.team_b?.logo_url}
                <img
                  src={match.team_b.logo_url}
                  alt="{teamTag(match.team_b)} logo"
                  class="h-8 w-8 rounded-sm object-contain sm:order-2"
                />
              {:else}
                <div
                  class="flex h-8 w-8 items-center justify-center rounded-sm border text-[10px] font-bold sm:order-2"
                  style="border-color: rgba(255,255,255,0.18); color: rgba(255,255,255,0.75); background: rgba(0,0,0,0.18);"
                >
                  {teamTag(match.team_b) || '—'}
                </div>
              {/if}
            </div>
          </div>

          <!-- Match details: stacked on mobile, horizontal on sm+ -->
          <div
            class="mt-3 flex flex-col items-start gap-2 text-sm sm:mt-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
            style="color: var(--text);"
          >
            <a
              href={`/matches/${match.id}`}
              class="font-medium underline"
              style="color: var(--title);"
            >
              {formatUtc(match.scheduled_at)}
            </a>
            <span class="hidden text-xs sm:inline" style="color: var(--text); opacity: 0.7;">•</span
            >
            <span class="text-xs sm:text-sm">
              {#if (match.maps ?? []).length > 0}
                Maps: {(match.maps ?? []).join(' / ')} (BO{match.best_of})
              {:else}
                Maps: TBD (BO{match.best_of})
              {/if}
            </span>
            <div class="flex items-center gap-2 sm:ml-auto">
              <a
                href={`/matches/${match.id}`}
                class="rounded px-2 py-1 text-xs underline sm:text-sm"
                style="color: var(--title);"
              >
                View
              </a>

              {#if match.primary_stream_url}
                <span class="text-xs" style="color: var(--text); opacity: 0.65;">•</span>
                <a
                  href={match.primary_stream_url}
                  class="rounded px-2 py-1 text-xs underline sm:text-sm"
                  style="color: var(--title);"
                  rel="noreferrer"
                  target="_blank"
                >
                  Watch
                </a>
              {/if}
            </div>
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>
