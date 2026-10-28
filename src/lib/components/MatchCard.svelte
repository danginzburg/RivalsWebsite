<script lang="ts">
  import TeamSeed from '$lib/components/TeamSeed.svelte'
  import { resolve } from '$app/paths'

  type CardTeam = { id?: string; name?: string; logo_url?: string | null }

  interface Props {
    match: {
      id: string
      status: string
      best_of: number
      scheduled_at: string | null
      team_a_score: number | null
      team_b_score: number | null
      designation?: unknown
      team_a: CardTeam | CardTeam[] | null
      team_b: CardTeam | CardTeam[] | null
    }
    /** Standings position per team id, from each match's own season. */
    seeds?: Record<string, number>
  }

  let { match, seeds = {} }: Props = $props()

  function team(value: CardTeam | CardTeam[] | null): CardTeam | null {
    if (!value) return null
    return Array.isArray(value) ? (value[0] ?? null) : value
  }

  const teamA = $derived(team(match.team_a))
  const teamB = $derived(team(match.team_b))
  const scoreA = $derived(match.team_a_score ?? 0)
  const scoreB = $derived(match.team_b_score ?? 0)

  function seedOf(t: CardTeam | null): number | null {
    return t?.id ? (seeds[t.id] ?? null) : null
  }

  function formatLocal(value: string | null | undefined) {
    if (!value) return 'Date TBD'
    return new Date(value).toLocaleString(undefined, { timeZoneName: 'short' })
  }
</script>

<a href={resolve(`/matches/${match.id}`)} class="match-card">
  {#if match.designation}
    <div class="designation">{match.designation}</div>
  {/if}
  <div class="match-teams">
    <div class="match-team">
      <TeamSeed seed={seedOf(teamA)} label="Leaderboard rank" />
      {#if teamA?.logo_url}
        <img src={teamA.logo_url} alt="{teamA.name ?? 'Team'} logo" class="team-logo" />
      {:else}
        <div class="team-logo-placeholder"></div>
      {/if}
      <strong class="team-name">{teamA?.name ?? 'Team'}</strong>
    </div>

    {#if match.status === 'completed'}
      <div class="match-score">
        <span class="score-num" class:score-winner={scoreA > scoreB}>{scoreA}</span>
        <span class="score-sep">–</span>
        <span class="score-num" class:score-winner={scoreB > scoreA}>{scoreB}</span>
      </div>
    {:else}
      <span class="match-vs">vs</span>
    {/if}

    <div class="match-team match-team-right">
      <strong class="team-name">{teamB?.name ?? 'Team'}</strong>
      {#if teamB?.logo_url}
        <img src={teamB.logo_url} alt="{teamB.name ?? 'Team'} logo" class="team-logo" />
      {:else}
        <div class="team-logo-placeholder"></div>
      {/if}
      <TeamSeed seed={seedOf(teamB)} label="Leaderboard rank" />
    </div>
  </div>

  <div class="match-meta">
    <span class="match-format">BO{match.best_of}</span>
    <span class="meta-dot">·</span>
    <span>{formatLocal(match.scheduled_at)}</span>
  </div>
</a>

<style>
  .match-card {
    display: block;
    padding: 1rem 1.25rem;
    border-radius: 0.625rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.2);
    text-decoration: none;
    color: var(--text);
    transition:
      border-color 0.15s,
      background 0.15s;
  }

  .match-card:hover {
    border-color: rgba(120, 67, 145, 0.45);
    background: rgba(255, 255, 255, 0.03);
  }

  .designation {
    display: block;
    text-align: center;
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #fcd34d;
    margin-bottom: 0.625rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid rgba(252, 211, 77, 0.18);
  }

  .match-teams {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1.5rem;
  }

  .match-team {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex: 1;
    min-width: 0;
  }

  .match-team-right {
    flex-direction: row-reverse;
    text-align: right;
  }

  .team-logo {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 0.375rem;
    object-fit: contain;
    flex-shrink: 0;
  }

  .team-logo-placeholder {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 0.375rem;
    background: rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
  }

  .team-name {
    font-size: 0.9375rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .match-vs {
    font-size: 0.75rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.6);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-shrink: 0;
  }

  .match-score {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .score-num {
    font-size: 1.25rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: rgba(255, 255, 255, 0.5);
  }

  .score-winner {
    color: #4ade80;
  }

  .score-sep {
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.52);
  }

  .match-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.5rem;
    justify-content: center;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
    flex-wrap: wrap;
  }

  .match-format {
    font-weight: 600;
  }

  .meta-dot {
    opacity: 0.4;
  }

  @media (max-width: 640px) {
    .match-card {
      padding: 0.875rem 1rem;
    }

    .match-teams {
      gap: 0.75rem;
    }

    .team-logo,
    .team-logo-placeholder {
      width: 2rem;
      height: 2rem;
    }

    .team-name {
      font-size: 0.8125rem;
    }

    .score-num {
      font-size: 1rem;
    }
  }
</style>
