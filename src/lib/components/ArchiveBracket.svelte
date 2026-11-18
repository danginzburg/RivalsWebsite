<script lang="ts">
  import type { PickemSlot } from '$lib/pickems'

  type BracketTeam = { id: string; name: string; tag: string | null; logo_url?: string | null }
  /** Score, date and forfeit of a slot's real match, oriented to the slot's teams. */
  type BracketSeries = { a: number | null; b: number | null; at: string | null; forfeit: boolean }

  interface Props {
    slots: PickemSlot[]
    teams: Record<string, BracketTeam>
    /** Playoff seeds keyed by team id, from the bracket config. */
    seeds?: Record<string, number>
    /** The real match behind each slot, keyed by slot id; linked series open it. */
    matchIds?: Record<string, string>
    /** Series score per slot id, in slot order (team A, team B). */
    scores?: Record<string, [number | null, number | null]>
    /** Score, date and forfeit per slot id (from `loadSeasonBracket`); `scores` wins when both are given. */
    series?: Record<string, BracketSeries>
    /** A search query: teams that don't match it fade so the matches stand out. */
    query?: string
    /** The viewer's team, named in the accent colour. */
    myTeamId?: string | null
  }

  let {
    slots,
    teams,
    seeds = {},
    matchIds = {},
    scores = {},
    series = {},
    query = '',
    myTeamId = null,
  }: Props = $props()

  const slotById = $derived(new Map(slots.map((s) => [s.id, s])))

  function group(ids: string[]) {
    return ids.map((id) => slotById.get(id)).filter(Boolean) as PickemSlot[]
  }

  type Round = { name: string; conn: 'merge' | 'straight' | null; slots: PickemSlot[] }

  const upper = $derived<Round[]>([
    {
      name: 'Quarterfinals',
      conn: 'merge',
      slots: group(['ub_qf_1', 'ub_qf_2', 'ub_qf_3', 'ub_qf_4']),
    },
    { name: 'Semifinals', conn: 'merge', slots: group(['ub_sf_1', 'ub_sf_2']) },
    { name: 'Upper Final', conn: 'straight', slots: group(['ub_final']) },
    { name: 'Grand Final', conn: null, slots: group(['grand_final']) },
  ])

  const lower = $derived<Round[]>([
    { name: 'Round 1', conn: 'straight', slots: group(['lb_r1_1', 'lb_r1_2']) },
    { name: 'Round 2', conn: 'merge', slots: group(['lb_r2_1', 'lb_r2_2']) },
    { name: 'Round 3', conn: 'straight', slots: group(['lb_r3']) },
    { name: 'Lower Final', conn: null, slots: group(['lb_final']) },
  ])

  const q = $derived(query.trim().toLowerCase())

  /** The column head already names the bracket, so "Upper QF 1" reads as "QF 1". */
  function shortLabel(label: string) {
    const rest = label.replace(/^(Upper|Lower)\s+/i, '')
    return /^final$/i.test(rest) ? label : rest
  }

  const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })

  function when(slot: PickemSlot) {
    const at = series[slot.id]?.at
    return at ? dateFmt.format(new Date(at)) : ''
  }

  function scoreOf(slot: PickemSlot, index: number): number | null {
    const pair = scores[slot.id]
    if (pair) return pair[index] ?? null
    const s = series[slot.id]
    return s ? (index === 0 ? s.a : s.b) : null
  }

  function matchesQuery(id: string | null) {
    if (!q) return true
    const team = id ? teams[id] : null
    return team ? [team.name, team.tag].filter(Boolean).join(' ').toLowerCase().includes(q) : false
  }
</script>

<div class="bracket">
  {@render half('Upper bracket', upper)}
  {@render half('Lower bracket', lower)}
</div>

{#snippet half(title: string, rounds: Round[])}
  <div class="half">
    <div class="half-label">{title}</div>
    <!-- Wide brackets scroll inside their own box, never the page. -->
    <div class="scroll">
      <div class="flow">
        {#each rounds as round (round.name)}
          <div class="round">
            <div class="round-label">{round.name}</div>
            <div
              class="slots"
              class:conn-merge={round.conn === 'merge'}
              class:conn-straight={round.conn === 'straight'}
            >
              {#each round.slots as slot (slot.id)}
                <div class="slot">{@render seriesBox(slot)}</div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>
{/snippet}

{#snippet seriesBox(slot: PickemSlot)}
  {@const matchId = matchIds[slot.id]}
  {@const date = when(slot)}
  <svelte:element
    this={matchId ? 'a' : 'div'}
    href={matchId ? `/matches/${matchId}` : undefined}
    class="series"
  >
    <div class="series-head">
      <span class="series-label"
        >{shortLabel(slot.label)}{#if series[slot.id]?.forfeit}&nbsp;· Forfeit{/if}</span
      >
      {#if date}<span>{date}</span>{/if}
    </div>
    {#each [slot.teamAId, slot.teamBId] as teamId, index (`${slot.id}-${index}`)}
      {@const team = teamId ? teams[teamId] : null}
      {@const seed = teamId ? (seeds[teamId] ?? null) : null}
      {@const score = scoreOf(slot, index)}
      <div
        class="team"
        class:win={Boolean(slot.winnerId) && teamId === slot.winnerId}
        class:lose={Boolean(slot.winnerId) && Boolean(team) && teamId !== slot.winnerId}
        class:tbd={!team}
        class:mine={Boolean(myTeamId) && teamId === myTeamId}
        class:faded={Boolean(q) && !matchesQuery(teamId)}
        title={team?.name}
      >
        <span class="seed">{seed ?? ''}</span>
        {#if team?.logo_url}
          <img src={team.logo_url} alt="" class="logo" />
        {:else}
          <span class="logo logo-blank"></span>
        {/if}
        <span class="name">{team ? (team.tag ?? team.name) : 'TBD'}</span>
        <span class="score">{score ?? ''}</span>
      </div>
    {/each}
  </svelte:element>
{/snippet}

<style>
  .bracket {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    --conn: rgba(255, 255, 255, 0.1);
    --conn-w: 1.125rem;
  }

  .half-label,
  .round-label {
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .half-label {
    color: rgba(255, 255, 255, 0.55);
    margin-bottom: 0.375rem;
  }

  .round-label {
    color: rgba(255, 255, 255, 0.5);
    padding: 0 0.125rem 0.375rem;
  }

  .scroll {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 0.25rem;
  }

  .flow {
    display: flex;
    gap: calc(var(--conn-w) * 2);
    min-width: 48.75rem;
  }

  .round {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  /* Columns stretch to the tallest one; equal-height slots keep connectors centred. */
  .slots {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .slot {
    flex: 1;
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0.1875rem 0;
  }

  /* Connectors: a pair merges into the next round, or a series feeds straight on. */
  .conn-merge > .slot::after,
  .conn-straight > .slot::after {
    content: '';
    position: absolute;
    right: calc(var(--conn-w) * -1);
    width: var(--conn-w);
  }

  .conn-merge > .slot:nth-child(odd)::after {
    top: 50%;
    bottom: 0;
    border-top: 1px solid var(--conn);
    border-right: 1px solid var(--conn);
  }

  .conn-merge > .slot:nth-child(even)::after {
    top: 0;
    bottom: 50%;
    border-bottom: 1px solid var(--conn);
    border-right: 1px solid var(--conn);
  }

  .conn-straight > .slot::after {
    top: 50%;
    border-top: 1px solid var(--conn);
  }

  .round + .round .slot::before {
    content: '';
    position: absolute;
    left: calc(var(--conn-w) * -1);
    width: var(--conn-w);
    top: 50%;
    border-top: 1px solid var(--conn);
  }

  /* Series: a faint box, no border */
  .series {
    display: block;
    border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.025);
    padding: 0.3125rem 0.3125rem 0.375rem;
    color: inherit;
    text-decoration: none;
  }

  a.series {
    transition: background-color 0.15s ease;
  }

  a.series:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  a.series:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.5);
    outline-offset: 1px;
  }

  .series-head {
    display: flex;
    justify-content: space-between;
    gap: 0.375rem;
    padding: 0 0.3125rem 0.1875rem;
    font-size: 0.625rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.5);
    white-space: nowrap;
  }

  .series-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .team {
    display: flex;
    align-items: center;
    gap: 0.4375rem;
    height: 1.875rem;
    padding: 0 0.4375rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.82);
    transition: opacity 0.15s ease;
  }

  .team + .team {
    margin-top: 0.125rem;
  }

  .seed {
    width: 0.75rem;
    flex-shrink: 0;
    text-align: center;
    font-size: 0.625rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.5);
    font-variant-numeric: tabular-nums;
  }

  .logo {
    width: 1.125rem;
    height: 1.125rem;
    border-radius: 0.25rem;
    object-fit: contain;
    flex-shrink: 0;
  }

  .logo-blank {
    background: rgba(255, 255, 255, 0.06);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .score {
    min-width: 0.875rem;
    flex-shrink: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: rgba(255, 255, 255, 0.6);
  }

  /* Winner by weight and brightness, loser dimmed: no coloured boxes. */
  .team.win {
    color: rgba(255, 255, 255, 0.92);
  }

  /* Green means "won", the same as round differential on the standings. */
  .team.win .score {
    color: var(--good);
    font-weight: 700;
  }

  .team.lose {
    color: rgba(255, 255, 255, 0.5);
    font-weight: 500;
  }

  .team.lose .logo {
    opacity: 0.55;
  }

  .team.lose .score {
    color: rgba(255, 255, 255, 0.45);
  }

  .team.tbd {
    color: rgba(255, 255, 255, 0.45);
    font-style: italic;
    font-weight: 500;
  }

  .team.mine .name {
    color: var(--accent-text, #c084fc);
  }

  .team.mine.lose .name {
    color: rgba(192, 132, 252, 0.65);
  }

  .team.faded {
    opacity: 0.25;
  }
</style>
