<script lang="ts">
  type Team = {
    name: string
    abbr: string
    logo: string
  }

  type Match = {
    teamA: Team
    teamB: Team
    datetime: string
    maps: string[]
    stream: string
  }

  let { matches }: { matches: Match[] } = $props()
</script>

<div class="matches-section-wrapper">
  <div class="flex w-full max-w-5xl flex-col gap-4">
    {#each matches as match}
      <div class="info-card info-card-surface relative">
        <!-- Team matchup: stacked on mobile, horizontal on sm+ -->
        <div class="flex flex-col items-center gap-2 sm:flex-row sm:gap-4">
          <!-- Team A -->
          <div
            class="flex w-full min-w-0 flex-1 items-center justify-center gap-3 sm:justify-start"
          >
            <img
              src={match.teamA.logo}
              alt="{match.teamA.abbr} logo"
              class="h-8 w-8 rounded-sm object-contain"
            />
            <p class="truncate text-lg font-semibold" style="color: var(--title);">
              {match.teamA.name}
            </p>
          </div>

          <!-- VS / BO3 indicator -->
          <div class="w-16 text-center">
            <p class="text-sm font-semibold" style="color: var(--text);">VS</p>
          </div>

          <!-- Team B -->
          <div class="flex w-full min-w-0 flex-1 items-center justify-center gap-3 sm:justify-end">
            <p class="truncate text-lg font-semibold sm:order-1" style="color: var(--title);">
              {match.teamB.name}
            </p>
            <img
              src={match.teamB.logo}
              alt="{match.teamB.abbr} logo"
              class="h-8 w-8 rounded-sm object-contain sm:order-2"
            />
          </div>
        </div>

        <!-- VS separator -->
        <div class="absolute bottom-2 left-1/2 -translate-x-1/2 transform pb-4">
          <p class="text-xs" style="color: var(--text);">BO3</p>
        </div>

        <!-- Match details: stacked on mobile, horizontal on sm+ -->
        <div
          class="mt-3 flex flex-col items-start gap-2 text-sm sm:mt-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
          style="color: var(--text);"
        >
          <span class="font-medium" style="color: var(--title);">{match.datetime}</span>
          <span class="hidden text-xs sm:inline" style="color: var(--text); opacity: 0.7;">•</span>
          <span class="text-xs sm:text-sm">Maps: {match.maps.join(' / ')}</span>
          <div class="flex items-center gap-2 sm:ml-auto">
            <span class="text-xs font-semibold" style="color: var(--text);">Stream:</span>
            <a
              href={match.stream}
              class="rounded px-2 py-1 text-xs underline sm:text-sm"
              style="color: var(--title);"
              rel="noreferrer"
            >
              Watch Live
            </a>
          </div>
        </div>
      </div>
    {/each}
  </div>
</div>
