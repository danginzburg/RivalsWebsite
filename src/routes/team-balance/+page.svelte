<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { CheckCircle, XCircle, Users } from 'lucide-svelte'
  import { TEAM_BALANCE_RANKS, MAX_TEAM_AVERAGE, getRankValue } from '$lib/team-balance'

  const rankOptions = TEAM_BALANCE_RANKS.map((r) => ({ value: r.name, label: r.name }))

  type Player = {
    name: string
    rank: string
  }

  let players: Player[] = $state([
    { name: '', rank: '' },
    { name: '', rank: '' },
    { name: '', rank: '' },
    { name: '', rank: '' },
    { name: '', rank: '' },
  ])

  let filledPlayers = $derived(players.filter((p) => p.rank !== ''))
  let totalValue = $derived(filledPlayers.reduce((sum, p) => sum + getRankValue(p.rank), 0))
  let average = $derived(filledPlayers.length > 0 ? totalValue / filledPlayers.length : 0)
  let isEligible = $derived(filledPlayers.length === 5 && average <= MAX_TEAM_AVERAGE)
  let allFilled = $derived(filledPlayers.length === 5)

  function clearAll() {
    players = [
      { name: '', rank: '' },
      { name: '', rank: '' },
      { name: '', rank: '' },
      { name: '', rank: '' },
      { name: '', rank: '' },
    ]
  }
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-5xl">
      <div class="mb-8 flex flex-col items-center">
        <Users size={48} class="mb-4" style="color: var(--text);" />
        <h1 class="responsive-title mb-2 text-center">Team Balance Calculator</h1>
        <p class="responsive-text mb-6 text-center" style="color: var(--text);">
          Enter 5 players and their ranks to check if your team meets the average requirement (≤
          {MAX_TEAM_AVERAGE})
        </p>
      </div>

      <div class="info-card info-card-surface mb-6 p-4">
        <div
          class="mb-2 hidden grid-cols-[40px_1fr_1fr_60px] gap-4 border-b px-2 py-3 text-xs font-bold tracking-wider uppercase sm:grid"
          style="border-color: rgba(255, 255, 255, 0.2); color: rgba(255,255,255,0.75);"
        >
          <span>#</span>
          <span>Player Name</span>
          <span>Rank</span>
          <span>Value</span>
        </div>

        {#each players as player, i}
          <div
            class="grid grid-cols-[30px_1fr_50px] grid-rows-2 items-center gap-2 rounded-lg p-2 transition-colors sm:grid-cols-[40px_1fr_1fr_60px] sm:grid-rows-1 sm:gap-4"
            style="color: var(--text);"
          >
            <span class="text-center text-lg font-bold">{i + 1}</span>
            <input
              type="text"
              id="player-{i}-name"
              bind:value={player.name}
              placeholder="Enter name"
              class="w-full rounded-md border px-3 py-2 text-sm sm:col-auto"
              style="border-color: rgba(255,255,255,0.15); background: rgba(0,0,0,0.3); color: var(--text);"
            />
            <div class="col-span-2 sm:col-auto">
              <CustomSelect
                options={rankOptions}
                bind:value={player.rank}
                placeholder="Select rank..."
                id="player-{i}-rank"
              />
            </div>
            <span class="row-span-2 flex items-center justify-center text-center sm:row-auto">
              {#if player.rank}
                <span class="text-base font-bold" style="color: #a78bfa;"
                  >{getRankValue(player.rank)}</span
                >
              {:else}
                <span style="color: rgba(255,255,255,0.35);">—</span>
              {/if}
            </span>
          </div>
        {/each}
      </div>

      <div class="info-card info-card-surface p-6">
        <h2 class="mb-6 text-center text-2xl font-bold" style="color: var(--title);">
          Team Summary
        </h2>

        <div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div class="rounded-lg p-3 text-center" style="background: rgba(0,0,0,0.2);">
            <span class="block text-xs tracking-wider uppercase opacity-70">Players Entered</span>
            <span class="text-2xl font-bold">{filledPlayers.length} / 5</span>
          </div>
          <div class="rounded-lg p-3 text-center" style="background: rgba(0,0,0,0.2);">
            <span class="block text-xs tracking-wider uppercase opacity-70">Total Value</span>
            <span class="text-2xl font-bold">{totalValue}</span>
          </div>
          <div class="rounded-lg p-3 text-center" style="background: rgba(0,0,0,0.2);">
            <span class="block text-xs tracking-wider uppercase opacity-70">Team Average</span>
            <span
              class="text-2xl font-bold"
              style={allFilled && average > MAX_TEAM_AVERAGE
                ? 'color: #f87171;'
                : 'color: #4ade80;'}
            >
              {average.toFixed(2)}
            </span>
          </div>
          <div class="rounded-lg p-3 text-center" style="background: rgba(0,0,0,0.2);">
            <span class="block text-xs tracking-wider uppercase opacity-70">Maximum Allowed</span>
            <span class="text-2xl font-bold">{MAX_TEAM_AVERAGE}</span>
          </div>
        </div>

        {#if allFilled}
          <div
            class="mb-4 flex items-center justify-center gap-3 rounded-lg p-4 text-center text-lg font-bold"
            style={isEligible
              ? 'background: rgba(74, 222, 128, 0.2); color: #4ade80; border: 1px solid rgba(74, 222, 128, 0.4);'
              : 'background: rgba(248, 113, 113, 0.2); color: #f87171; border: 1px solid rgba(248, 113, 113, 0.4);'}
          >
            {#if isEligible}
              <CheckCircle size={32} />
              <span>Team is ELIGIBLE! Average ({average.toFixed(2)}) ≤ {MAX_TEAM_AVERAGE}</span>
            {:else}
              <XCircle size={32} />
              <span
                >Team is NOT ELIGIBLE. Average ({average.toFixed(2)}) exceeds {MAX_TEAM_AVERAGE}</span
              >
            {/if}
          </div>
        {:else}
          <div
            class="mb-4 flex items-center justify-center rounded-lg p-4 italic"
            style="background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.75);"
          >
            <span>Enter all 5 players to check eligibility</span>
          </div>
        {/if}

        <button
          type="button"
          class="w-full rounded-md px-4 py-3 text-base font-bold transition-opacity hover:opacity-90"
          style="background: var(--accent); color: var(--text);"
          onclick={clearAll}
        >
          Clear All
        </button>
      </div>
    </div>
  </div>
</PageContainer>
