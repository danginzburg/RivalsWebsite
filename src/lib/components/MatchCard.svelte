<script lang="ts">
  import TeamSeed from '$lib/components/TeamSeed.svelte'
  import { resolve } from '$app/paths'

  type CardTeam = { id?: string; name?: string; tag?: string | null; logo_url?: string | null }

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
    /**
     * Underway. Callers decide this from their own clock, since a match past its
     * start time still has a stored status of "scheduled".
     */
    live?: boolean
  }

  let { match, seeds = {}, live = false }: Props = $props()

  const isLive = $derived(live && match.status !== 'completed' && match.status !== 'cancelled')

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

<a href={resolve(`/matches/${match.id}`)} class="match-card" class:match-card-live={isLive}>
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
      <strong class="team-name" title={teamA?.name ?? 'Team'}>
        <span class="name-full">{teamA?.name ?? 'Team'}</span>
        <span class="name-short">{teamA?.tag || teamA?.name || 'Team'}</span>
      </strong>
    </div>

    {#if match.status === 'completed'}
      <div class="match-score">
        <span class="score-num" class:score-winner={scoreA > scoreB}>{scoreA}</span>
        <span class="score-sep">–</span>
        <span class="score-num" class:score-winner={scoreB > scoreA}>{scoreB}</span>
      </div>
    {:else if isLive}
      <span class="match-live"><span class="live-dot"></span>Live</span>
    {:else}
      <span class="match-vs">vs</span>
    {/if}

    <div class="match-team match-team-right">
      <strong class="team-name" title={teamB?.name ?? 'Team'}>
        <span class="name-full">{teamB?.name ?? 'Team'}</span>
        <span class="name-short">{teamB?.tag || teamB?.name || 'Team'}</span>
      </strong>
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

<style src="./MatchCard.css"></style>
