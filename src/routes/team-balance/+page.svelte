<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { CheckCircle, XCircle, Users, BadgeCheck } from 'lucide-svelte'
  import { TEAM_BALANCE_RANKS, MAX_TEAM_AVERAGE, getRankValue } from '$lib/team-balance'
  import type { PageProps } from './$types'

  const rankOptions = TEAM_BALANCE_RANKS.map((r) => ({ value: r.name, label: r.name }))

  let { data }: PageProps = $props()

  type RatedPlayer = {
    profileId: string
    name: string
    rank: string | null
    value: number
    isManual: boolean
  }

  const ratedPlayers = $derived((data.ratedPlayers ?? []) as RatedPlayer[])

  /** Case-insensitive lookup of a registered player by the typed name. */
  const ratedByName = $derived(new Map(ratedPlayers.map((p) => [p.name.trim().toLowerCase(), p])))

  type Player = {
    name: string
    rank: string
  }

  const blankRoster = (): Player[] => [
    { name: '', rank: '' },
    { name: '', rank: '' },
    { name: '', rank: '' },
    { name: '', rank: '' },
    { name: '', rank: '' },
  ]

  let players: Player[] = $state(blankRoster())

  /** The registered player matching a row, if the typed name resolves to one. */
  function matchedPlayer(player: Player): RatedPlayer | null {
    const key = player.name.trim().toLowerCase()
    if (!key) return null
    return ratedByName.get(key) ?? null
  }

  /**
   * A registered player's assigned value wins over the flat rank lookup —
   * that is the whole point of the signup formula.
   */
  function valueFor(player: Player): number | null {
    const matched = matchedPlayer(player)
    if (matched) return matched.value
    return player.rank ? getRankValue(player.rank) : null
  }

  /** A row counts toward the average once it has a value from either source. */
  let filledPlayers = $derived(players.filter((p) => valueFor(p) != null))
  let totalValue = $derived(filledPlayers.reduce((sum, p) => sum + (valueFor(p) ?? 0), 0))
  let average = $derived(filledPlayers.length > 0 ? totalValue / filledPlayers.length : 0)
  let isEligible = $derived(filledPlayers.length === 5 && average <= MAX_TEAM_AVERAGE)
  let allFilled = $derived(filledPlayers.length === 5)

  /** Selecting a registered player fills their rank in automatically. */
  function applyRatedPlayer(index: number, name: string) {
    const matched = ratedByName.get(name.trim().toLowerCase())
    if (matched?.rank) {
      players[index].rank = matched.rank
    }
  }

  function clearAll() {
    players = blankRoster()
  }
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-5xl">
      <div class="mb-8 flex flex-col items-center">
        <Users size={48} class="mb-4" style="color: var(--text);" />
        <h1 class="responsive-title mb-2 text-center">Team Balance Calculator</h1>
        <p class="responsive-text mb-2 text-center" style="color: var(--text);">
          Enter 5 players and their ranks to check if your team meets the average requirement (≤
          {MAX_TEAM_AVERAGE})
        </p>
        {#if ratedPlayers.length > 0}
          <p class="mb-6 text-center text-xs" style="color: rgba(255,255,255,0.5);">
            Registered players are recognized by name and use their assigned value automatically.
          </p>
        {/if}
      </div>

      {#if ratedPlayers.length > 0}
        <datalist id="rated-players">
          {#each ratedPlayers as rated (rated.profileId)}
            <option value={rated.name}></option>
          {/each}
        </datalist>
      {/if}

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

        {#each players as player, i (i)}
          {@const matched = matchedPlayer(player)}
          {@const resolvedValue = valueFor(player)}
          <div
            class="grid grid-cols-[30px_1fr_50px] grid-rows-2 items-center gap-2 rounded-lg p-2 transition-colors sm:grid-cols-[40px_1fr_1fr_60px] sm:grid-rows-1 sm:gap-4"
            style="color: var(--text);"
          >
            <span class="text-center text-lg font-bold">{i + 1}</span>
            <div class="relative sm:col-auto">
              <input
                type="text"
                id="player-{i}-name"
                list={ratedPlayers.length > 0 ? 'rated-players' : undefined}
                bind:value={player.name}
                oninput={() => applyRatedPlayer(i, player.name)}
                placeholder="Enter name"
                class="w-full rounded-md border px-3 py-2 text-sm"
                class:pr-8={matched}
                style="border-color: {matched
                  ? 'rgba(120,67,145,0.5)'
                  : 'rgba(255,255,255,0.15)'}; background: rgba(0,0,0,0.3); color: var(--text);"
              />
              {#if matched}
                <span
                  class="absolute top-1/2 right-2 -translate-y-1/2"
                  title="Registered player — using their assigned value{matched.isManual
                    ? ' (manually set)'
                    : ''}"
                >
                  <BadgeCheck size={15} style="color: #d8b4fe;" />
                </span>
              {/if}
            </div>
            <div class="col-span-2 sm:col-auto">
              <CustomSelect
                options={rankOptions}
                bind:value={player.rank}
                placeholder="Select rank..."
                id="player-{i}-rank"
              />
            </div>
            <span class="row-span-2 flex items-center justify-center text-center sm:row-auto">
              {#if resolvedValue != null}
                <span
                  class="text-base font-bold"
                  style="color: {matched ? '#d8b4fe' : '#a78bfa'};"
                  title={matched ? 'Assigned value from signup' : 'Value from rank'}
                >
                  {resolvedValue}
                </span>
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
