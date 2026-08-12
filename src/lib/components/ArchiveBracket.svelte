<script lang="ts">
  import type { PlayoffPickemSlot, PlayoffMatchId } from '$lib/playoffPickems'

  type BracketTeam = { id: string; name: string; tag: string | null; logo_url?: string | null }

  interface Props {
    slots: PlayoffPickemSlot[]
    teams: Record<string, BracketTeam>
    /** Playoff seeds keyed by team id, from the bracket config. */
    seeds?: Record<string, number>
  }

  let { slots, teams, seeds = {} }: Props = $props()

  function teamSeed(id: string | null): number | null {
    return id ? (seeds[id] ?? null) : null
  }

  const slotById = $derived(new Map(slots.map((s) => [s.id, s])))

  function group(ids: string[]) {
    return ids
      .map((id) => slotById.get(id as PlayoffMatchId))
      .filter(Boolean) as PlayoffPickemSlot[]
  }

  const ubQF = $derived(group(['ub_qf_1', 'ub_qf_2', 'ub_qf_3', 'ub_qf_4']))
  const ubSF = $derived(group(['ub_sf_1', 'ub_sf_2']))
  const ubFinal = $derived(group(['ub_final']))
  const grandFinal = $derived(group(['grand_final']))
  const lbR1 = $derived(group(['lb_r1_1', 'lb_r1_2']))
  const lbR2 = $derived(group(['lb_r2_1', 'lb_r2_2']))
  const lbR3 = $derived(group(['lb_r3']))
  const lbFinal = $derived(group(['lb_final']))

  function teamLabel(id: string | null) {
    if (!id) return 'TBD'
    const team = teams[id]
    return team ? (team.tag ?? team.name) : 'TBD'
  }

  function teamLogo(id: string | null) {
    if (!id) return null
    return teams[id]?.logo_url ?? null
  }
</script>

<div class="bracket-wrapper">
  <div class="bracket-section">
    <div class="bracket-label">Upper Bracket</div>
    <div class="bracket-scroll">
      <div class="bracket-flow">
        <div class="bracket-round conn-merge">
          {#each ubQF as slot (slot.id)}
            <div class="match-item">{@render matchCard(slot)}</div>
          {/each}
        </div>
        <div class="bracket-round conn-merge">
          {#each ubSF as slot (slot.id)}
            <div class="match-item">{@render matchCard(slot)}</div>
          {/each}
        </div>
        <div class="bracket-round conn-straight">
          {#each ubFinal as slot (slot.id)}
            <div class="match-item">{@render matchCard(slot)}</div>
          {/each}
        </div>
        <div class="bracket-round">
          {#each grandFinal as slot (slot.id)}
            <div class="match-item">{@render matchCard(slot, true)}</div>
          {/each}
        </div>
      </div>
    </div>
  </div>

  <div class="bracket-section">
    <div class="bracket-label">Lower Bracket</div>
    <div class="bracket-scroll">
      <div class="bracket-flow">
        <div class="bracket-round conn-straight">
          {#each lbR1 as slot (slot.id)}
            <div class="match-item">{@render matchCard(slot)}</div>
          {/each}
        </div>
        <div class="bracket-round conn-merge">
          {#each lbR2 as slot (slot.id)}
            <div class="match-item">{@render matchCard(slot)}</div>
          {/each}
        </div>
        <div class="bracket-round conn-straight">
          {#each lbR3 as slot (slot.id)}
            <div class="match-item">{@render matchCard(slot)}</div>
          {/each}
        </div>
        <div class="bracket-round">
          {#each lbFinal as slot (slot.id)}
            <div class="match-item">{@render matchCard(slot)}</div>
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>

{#snippet matchCard(slot: PlayoffPickemSlot, isGrandFinal = false)}
  <article class="match-card" class:gf={isGrandFinal}>
    <div class="match-header">
      <span class="match-label">{slot.label}</span>
    </div>
    {#each [slot.teamAId, slot.teamBId] as teamId, index (`${slot.id}-${index}`)}
      {@const seed = teamSeed(teamId)}
      <div
        class="team-row"
        class:winner={Boolean(slot.winnerId) && teamId === slot.winnerId}
        class:tbd={!teamId}
      >
        {#if seed != null}
          <span class="team-seed" title="Seed {seed}">{seed}</span>
        {/if}
        {#if teamLogo(teamId)}
          <img src={teamLogo(teamId) ?? ''} alt="" class="team-logo" />
        {:else}
          <span class="team-logo-blank"></span>
        {/if}
        <span class="team-name">{teamLabel(teamId)}</span>
      </div>
    {/each}
  </article>
{/snippet}

<style>
  .bracket-wrapper {
    display: flex;
    flex-direction: column;
    gap: 1.75rem;
    --conn: rgba(255, 255, 255, 0.16);
    --conn-w: 1rem;
  }

  .bracket-label {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: rgba(255, 255, 255, 0.6);
    margin-bottom: 0.625rem;
  }

  /* Wide brackets scroll inside their own container, never the page. */
  .bracket-scroll {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 0.5rem;
  }

  .bracket-flow {
    display: flex;
    gap: calc(var(--conn-w) * 2);
    min-width: 44rem;
  }

  .bracket-round {
    flex: 1;
    display: flex;
    flex-direction: column;
    position: relative;
    min-width: 0;
  }

  .match-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    position: relative;
    padding: 0.25rem 0;
  }

  /* Connectors: pair merges into the next round */
  .conn-merge > .match-item:nth-of-type(odd)::after,
  .conn-merge > .match-item:nth-of-type(even)::after {
    content: '';
    position: absolute;
    left: 100%;
    width: var(--conn-w);
    border-right: 1px solid var(--conn);
  }

  .conn-merge > .match-item:nth-of-type(odd)::after {
    top: 50%;
    bottom: 0;
    border-top: 1px solid var(--conn);
  }

  .conn-merge > .match-item:nth-of-type(even)::after {
    top: 0;
    bottom: 50%;
    border-bottom: 1px solid var(--conn);
  }

  .conn-straight > .match-item::after {
    content: '';
    position: absolute;
    left: 100%;
    top: 50%;
    width: var(--conn-w);
    border-top: 1px solid var(--conn);
  }

  /* Match card */
  .match-card {
    border-radius: 0.4375rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(0, 0, 0, 0.28);
    overflow: hidden;
  }

  .match-card.gf {
    border-color: rgba(252, 211, 77, 0.35);
  }

  .match-header {
    padding: 0.25rem 0.5rem;
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .match-label {
    font-size: 0.5625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: rgba(255, 255, 255, 0.62);
  }

  .match-card.gf .match-label {
    color: #fcd34d;
  }

  .team-row {
    display: flex;
    align-items: center;
    gap: 0.4375rem;
    padding: 0.375rem 0.5rem;
    font-size: 0.75rem;
  }

  .team-row + .team-row {
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .team-row.winner {
    background: rgba(74, 222, 128, 0.1);
  }

  .team-row.winner .team-name {
    color: #86efac;
    font-weight: 700;
  }

  .team-row.tbd .team-name {
    color: rgba(255, 255, 255, 0.5);
    font-style: italic;
  }

  .team-logo {
    width: 1rem;
    height: 1rem;
    border-radius: 0.125rem;
    object-fit: contain;
    flex-shrink: 0;
  }

  .team-logo-blank {
    width: 1rem;
    height: 1rem;
    border-radius: 0.125rem;
    background: rgba(255, 255, 255, 0.05);
    flex-shrink: 0;
  }

  .team-seed {
    flex-shrink: 0;
    min-width: 0.75rem;
    font-size: 0.5625rem;
    font-weight: 700;
    text-align: center;
    color: rgba(255, 255, 255, 0.58);
    font-variant-numeric: tabular-nums;
  }

  .team-name {
    color: rgba(255, 255, 255, 0.8);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
