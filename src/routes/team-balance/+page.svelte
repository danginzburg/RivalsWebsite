<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { CheckCircle, XCircle, Users } from 'lucide-svelte'

  const ranks = [
    { name: 'Unranked', value: 0 },
    { name: 'Iron 1', value: 28 },
    { name: 'Iron 2', value: 28 },
    { name: 'Iron 3', value: 28 },
    { name: 'Bronze 1', value: 28 },
    { name: 'Bronze 2', value: 28 },
    { name: 'Bronze 3', value: 28 },
    { name: 'Silver 1', value: 29 },
    { name: 'Silver 2', value: 29 },
    { name: 'Silver 3', value: 29 },
    { name: 'Gold 1', value: 30 },
    { name: 'Gold 2', value: 30 },
    { name: 'Gold 3', value: 30 },
    { name: 'Platinum 1', value: 30.5 },
    { name: 'Platinum 2', value: 31.5 },
    { name: 'Platinum 3', value: 32.5 },
    { name: 'Diamond 1', value: 33.5 },
    { name: 'Diamond 2', value: 34.5 },
    { name: 'Diamond 3', value: 35.5 },
    { name: 'Ascendant 1', value: 36.5 },
    { name: 'Ascendant 2', value: 38 },
    { name: 'Ascendant 3', value: 39.5 },
    { name: 'Immortal 0RR', value: 41 },
    { name: 'Immortal 100RR', value: 43 },
    { name: 'Immortal 200RR', value: 45 },
    { name: 'Immortal 300RR', value: 46 },
    { name: 'Radiant 450RR', value: 48 },
    { name: 'Radiant 600RR', value: 49 },
    { name: 'Radiant 750+RR', value: 50 },
  ]

  const rankOptions = ranks.map((r) => ({ value: r.name, label: r.name }))

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

  const MAX_AVERAGE = 36.5

  function getRankValue(rankName: string): number {
    const rank = ranks.find((r) => r.name === rankName)
    return rank ? rank.value : 0
  }

  let filledPlayers = $derived(players.filter((p) => p.rank !== ''))
  let totalValue = $derived(filledPlayers.reduce((sum, p) => sum + getRankValue(p.rank), 0))
  let average = $derived(filledPlayers.length > 0 ? totalValue / filledPlayers.length : 0)
  let isEligible = $derived(filledPlayers.length === 5 && average <= MAX_AVERAGE)
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
  <div class="calculator-page-wrapper">
    <div class="calculator-container">
      <div class="header-section">
        <Users size={48} class="header-icon" />
        <h1 class="responsive-title mb-2 text-center">Team Balance Calculator</h1>
        <p class="responsive-text mb-6 text-center" style="color: var(--text);">
          Enter 5 players and their ranks to check if your team meets the average requirement (≤
          {MAX_AVERAGE})
        </p>
      </div>

      <div class="players-container info-card info-card-surface">
        <div class="players-header">
          <span class="header-cell">#</span>
          <span class="header-cell">Player Name</span>
          <span class="header-cell">Rank</span>
          <span class="header-cell">Value</span>
        </div>
        {#each players as player, i}
          <div class="player-row">
            <span class="player-number">{i + 1}</span>
            <input
              type="text"
              id="player-{i}-name"
              bind:value={player.name}
              placeholder="Enter name"
              class="text-input"
            />
            <CustomSelect
              options={rankOptions}
              bind:value={player.rank}
              placeholder="Select rank..."
              id="player-{i}-rank"
            />
            <span class="rank-value">
              {#if player.rank}
                <span class="value-number">{getRankValue(player.rank)}</span>
              {:else}
                <span class="value-placeholder">—</span>
              {/if}
            </span>
          </div>
        {/each}
      </div>

      <div class="results-section info-card info-card-surface">
        <h2 class="results-title">Team Summary</h2>

        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-label">Players Entered</span>
            <span class="stat-value">{filledPlayers.length} / 5</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Total Value</span>
            <span class="stat-value">{totalValue}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Team Average</span>
            <span class="stat-value average" class:over={allFilled && average > MAX_AVERAGE}>
              {average.toFixed(2)}
            </span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Maximum Allowed</span>
            <span class="stat-value">{MAX_AVERAGE}</span>
          </div>
        </div>

        {#if allFilled}
          <div
            class="eligibility-result"
            class:eligible={isEligible}
            class:ineligible={!isEligible}
          >
            {#if isEligible}
              <CheckCircle size={32} />
              <span>Team is ELIGIBLE! Average ({average.toFixed(2)}) ≤ {MAX_AVERAGE}</span>
            {:else}
              <XCircle size={32} />
              <span>Team is NOT ELIGIBLE. Average ({average.toFixed(2)}) exceeds {MAX_AVERAGE}</span
              >
            {/if}
          </div>
        {:else}
          <div class="eligibility-pending">
            <span>Enter all 5 players to check eligibility</span>
          </div>
        {/if}

        <button type="button" class="clear-button" onclick={clearAll}> Clear All </button>
      </div>
    </div>
  </div>
</PageContainer>

<style>
  .calculator-page-wrapper {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 2rem 0.5rem;
    min-height: 60vh;
  }

  @media (min-width: 640px) {
    .calculator-page-wrapper {
      padding: 2rem 1rem;
    }
  }

  .calculator-container {
    width: 100%;
    max-width: 900px;
  }

  .header-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-bottom: 2rem;
  }

  .header-section :global(.header-icon) {
    color: var(--text);
    margin-bottom: 1rem;
    filter: drop-shadow(0 3px 8px var(--accent));
  }

  .players-container {
    display: flex;
    flex-direction: column;
    margin-bottom: 2rem;
    padding: 1rem;
  }

  .players-header {
    display: grid;
    grid-template-columns: 40px 1fr 1fr 60px;
    gap: 1rem;
    padding: 0.75rem 0.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    margin-bottom: 0.5rem;
  }

  .header-cell {
    font-size: 0.8rem;
    font-weight: bold;
    color: var(--text);
    opacity: 0.7;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .player-row {
    display: grid;
    grid-template-columns: 40px 1fr 1fr 60px;
    gap: 1rem;
    align-items: center;
    padding: 0.5rem;
    border-radius: 0.5rem;
    transition: background-color 0.2s ease;
  }

  .player-row:hover {
    background-color: rgba(255, 255, 255, 0.05);
  }

  .player-number {
    font-size: 1.1rem;
    font-weight: bold;
    color: var(--text);
    text-align: center;
  }

  .text-input {
    padding: 0.625rem 0.875rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background-color: rgba(0, 0, 0, 0.3);
    color: var(--text);
    font-size: 0.95rem;
    transition:
      border-color 0.2s ease,
      box-shadow 0.2s ease;
    width: 100%;
  }

  .text-input::placeholder {
    color: rgba(255, 255, 255, 0.4);
  }

  .text-input:focus {
    outline: none;
    border-color: var(--hover);
    box-shadow: 0 0 0 3px rgba(120, 67, 145, 0.3);
  }

  .rank-value {
    text-align: center;
  }

  .value-number {
    font-weight: bold;
    color: #a78bfa;
    font-size: 1rem;
  }

  .value-placeholder {
    color: rgba(255, 255, 255, 0.3);
  }

  @media (max-width: 640px) {
    .players-header {
      display: none;
    }

    .player-row {
      grid-template-columns: 30px 1fr 50px;
      grid-template-rows: auto auto;
      gap: 0.5rem;
    }

    .player-row .text-input {
      grid-column: 2 / 3;
      grid-row: 1;
    }

    .player-row :global(.custom-select) {
      grid-column: 1 / 3;
      grid-row: 2;
    }

    .rank-value {
      grid-column: 3;
      grid-row: 1 / 3;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  }

  .results-section {
    padding: 1.5rem;
  }

  .results-title {
    font-size: 1.5rem;
    font-weight: bold;
    color: var(--text);
    text-align: center;
    margin-bottom: 1.5rem;
    text-shadow: 0 2px 6px var(--accent);
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  @media (min-width: 640px) {
    .stats-grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.75rem;
    background-color: rgba(0, 0, 0, 0.2);
    border-radius: 0.5rem;
  }

  .stat-label {
    font-size: 0.8rem;
    color: var(--text);
    opacity: 0.7;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .stat-value {
    font-size: 1.5rem;
    font-weight: bold;
    color: var(--text);
  }

  .stat-value.average {
    color: #4ade80;
  }

  .stat-value.average.over {
    color: #f87171;
  }

  .eligibility-result {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 1rem;
    border-radius: 0.5rem;
    font-weight: bold;
    font-size: 1.1rem;
    margin-bottom: 1rem;
  }

  .eligibility-result.eligible {
    background-color: rgba(74, 222, 128, 0.2);
    color: #4ade80;
    border: 1px solid rgba(74, 222, 128, 0.4);
  }

  .eligibility-result.ineligible {
    background-color: rgba(248, 113, 113, 0.2);
    color: #f87171;
    border: 1px solid rgba(248, 113, 113, 0.4);
  }

  .eligibility-pending {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    border-radius: 0.5rem;
    background-color: rgba(255, 255, 255, 0.1);
    color: var(--text);
    opacity: 0.7;
    font-style: italic;
    margin-bottom: 1rem;
  }

  .clear-button {
    display: block;
    width: 100%;
    padding: 0.75rem 1.5rem;
    border-radius: 0.5rem;
    border: none;
    background-color: var(--accent);
    color: var(--text);
    font-weight: bold;
    font-size: 1rem;
    cursor: pointer;
    transition:
      background-color 0.2s ease,
      transform 0.2s ease;
  }

  .clear-button:hover {
    background-color: var(--hover);
    transform: translateY(-1px);
  }

  .clear-button:active {
    transform: translateY(0);
  }
</style>
