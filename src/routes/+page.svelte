<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import AdminEditLink from '$lib/components/AdminEditLink.svelte'
  import { resolve } from '$app/paths'

  let { data }: PageProps = $props()
  const matches = $derived(data.matches ?? [])
  const isAdmin = $derived(data.viewer?.isAdmin ?? false)
  let searchQuery = $state('')
  let activeTab = $state<'all' | 'live' | 'upcoming' | 'completed'>('all')

  /**
   * `status` on a match only changes when an admin edits it, so a match that
   * has reached its start time still reads as "scheduled". The tabs therefore
   * derive state from the clock, with the stored status as an override.
   *
   * Ticks so a match moves into Live on its own without a page refresh.
   */
  let now = $state(Date.now())
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 30_000)
    return () => clearInterval(id)
  })

  function isFinished(match: any) {
    return match.status === 'completed' || match.status === 'cancelled'
  }

  /** Underway: explicitly flagged live, or past its start time and unfinished. */
  function isLive(match: any) {
    if (isFinished(match)) return false
    if (match.status === 'live') return true
    return match.scheduled_at != null && new Date(match.scheduled_at).getTime() <= now
  }

  /** Still ahead of us. A match with no date set counts as upcoming. */
  function isUpcoming(match: any) {
    if (isFinished(match) || match.status === 'live') return false
    return match.scheduled_at == null || new Date(match.scheduled_at).getTime() > now
  }

  const filteredMatches = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase()
    const filtered = matches.filter((match: any) => {
      // Tab filter
      if (activeTab === 'live' && !isLive(match)) return false
      if (activeTab === 'upcoming' && !isUpcoming(match)) return false
      if (activeTab === 'completed' && match.status !== 'completed') return false

      if (!query) return true

      const haystack = [teamName(match.team_a), teamName(match.team_b), match.status]
        .join(' ')
        .toLowerCase()

      return haystack.includes(query)
    })
    return filtered.sort((a: any, b: any) => {
      // Completed tab: most recently finished first.
      if (activeTab === 'completed') {
        return endedTime(b) - endedTime(a)
      }

      // All tab groups by state so live and upcoming stay on top, with
      // completed matches trailing behind in reverse-chronological order.
      if (activeTab === 'all') {
        const rankDiff = statusRank(a) - statusRank(b)
        if (rankDiff !== 0) return rankDiff
        if (statusRank(a) === 2) return endedTime(b) - endedTime(a)
      }

      // Live and upcoming: soonest first.
      return scheduledTime(a) - scheduledTime(b)
    })
  })

  /** Sort bucket for the All tab: live (0) → upcoming (1) → finished (2). */
  function statusRank(match: any) {
    if (isLive(match)) return 0
    if (isFinished(match)) return 2
    return 1
  }

  function scheduledTime(match: any) {
    return match.scheduled_at ? new Date(match.scheduled_at).getTime() : Infinity
  }

  function endedTime(match: any) {
    const value = match.ended_at ?? match.scheduled_at
    return value ? new Date(value).getTime() : 0
  }

  const liveCount = $derived(matches.filter(isLive).length)
  const upcomingCount = $derived(matches.filter(isUpcoming).length)
  const completedCount = $derived(matches.filter((m: any) => m.status === 'completed').length)

  function teamName(value: unknown) {
    if (!value) return 'Team'
    if (Array.isArray(value)) return (value[0] as { name?: string } | undefined)?.name ?? 'Team'
    return (value as { name?: string }).name ?? 'Team'
  }

  function teamLogo(value: unknown) {
    if (!value) return null
    if (Array.isArray(value))
      return (value[0] as { logo_url?: string } | undefined)?.logo_url ?? null
    return (value as { logo_url?: string }).logo_url ?? null
  }

  function formatLocal(value: string | null | undefined) {
    if (!value) return 'Date TBD'
    const date = new Date(value)
    return date.toLocaleString(undefined, { timeZoneName: 'short' })
  }

  const tabs = $derived([
    { id: 'all' as const, label: 'All', count: matches.length },
    { id: 'live' as const, label: 'Live', count: liveCount },
    { id: 'upcoming' as const, label: 'Upcoming', count: upcomingCount },
    { id: 'completed' as const, label: 'Completed', count: completedCount },
  ])
</script>

<PageContainer>
  <div class="matches-feed">
    <div class="matches-feed-inner">
      <div class="feed-header">
        <div>
          <h1 class="feed-title">Matches</h1>
          <p class="feed-subtitle">Upcoming, live, and completed matches.</p>
        </div>
        <div class="feed-header-actions">
          {#if isAdmin}
            <AdminEditLink href="/admin?tab=matches" label="Manage Matches" />
          {/if}
        </div>
      </div>

      <!-- Tab bar -->
      <div class="tab-bar">
        <div class="tab-bar-inner">
          {#each tabs as tab (tab.id)}
            <button
              type="button"
              class="tab-item"
              class:tab-active={activeTab === tab.id}
              class:tab-live={tab.id === 'live' && tab.count > 0}
              onclick={() => (activeTab = tab.id)}
            >
              {#if tab.id === 'live' && tab.count > 0}
                <span class="live-dot"></span>
              {/if}
              <span>{tab.label}</span>
              <span class="tab-count">{tab.count}</span>
            </button>
          {/each}
        </div>
        <div class="tab-search">
          <input bind:value={searchQuery} class="search-input" placeholder="Search teams..." />
        </div>
      </div>

      <!-- Match list -->
      {#if filteredMatches.length === 0}
        <div class="empty-state">
          <p>
            {#if matches.length === 0}
              No matches available yet.
            {:else}
              No matches match the current filters.
            {/if}
          </p>
        </div>
      {:else}
        <div class="match-list">
          {#each filteredMatches as match (match.id)}
            <a href={resolve(`/matches/${match.id}`)} class="match-card">
              {#if match.designation}
                <div class="designation">{match.designation}</div>
              {/if}
              <div class="match-teams">
                <div class="match-team">
                  {#if teamLogo(match.team_a)}
                    <img
                      src={teamLogo(match.team_a)}
                      alt="{teamName(match.team_a)} logo"
                      class="team-logo"
                    />
                  {:else}
                    <div class="team-logo-placeholder"></div>
                  {/if}
                  <strong class="team-name">{teamName(match.team_a)}</strong>
                </div>

                {#if match.status === 'completed'}
                  <div class="match-score">
                    <span
                      class="score-num"
                      class:score-winner={match.team_a_score > match.team_b_score}
                      >{match.team_a_score}</span
                    >
                    <span class="score-sep">–</span>
                    <span
                      class="score-num"
                      class:score-winner={match.team_b_score > match.team_a_score}
                      >{match.team_b_score}</span
                    >
                  </div>
                {:else}
                  <span class="match-vs">vs</span>
                {/if}

                <div class="match-team match-team-right">
                  <strong class="team-name">{teamName(match.team_b)}</strong>
                  {#if teamLogo(match.team_b)}
                    <img
                      src={teamLogo(match.team_b)}
                      alt="{teamName(match.team_b)} logo"
                      class="team-logo"
                    />
                  {:else}
                    <div class="team-logo-placeholder"></div>
                  {/if}
                </div>
              </div>

              <div class="match-meta">
                <span class="match-format">BO{match.best_of}</span>
                <span class="meta-dot">·</span>
                <span>{formatLocal(match.scheduled_at)}</span>
              </div>
            </a>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</PageContainer>

<style>
  .matches-feed {
    display: flex;
    justify-content: center;
    width: 100%;
    padding: 1.5rem 1rem 2rem;
  }

  .matches-feed-inner {
    width: 100%;
    max-width: 80rem;
  }

  .feed-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.25rem;
  }

  .feed-title {
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--title);
    line-height: 1.2;
  }

  .feed-subtitle {
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.6);
    margin-top: 0.125rem;
  }

  .feed-header-actions {
    flex-shrink: 0;
  }

  /* Tab bar */
  .tab-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }

  .tab-bar-inner {
    display: flex;
    gap: 0.25rem;
    background: rgba(0, 0, 0, 0.25);
    border-radius: 0.5rem;
    padding: 0.25rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .tab-item {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    font-size: 0.8125rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.55);
    background: transparent;
    border: none;
    cursor: pointer;
    transition:
      color 0.15s,
      background 0.15s;
    white-space: nowrap;
  }

  .tab-item:hover {
    color: rgba(255, 255, 255, 0.85);
    background: rgba(255, 255, 255, 0.04);
  }

  .tab-active {
    color: var(--text);
    background: var(--accent);
  }

  .tab-active:hover {
    color: var(--text);
    background: var(--hover);
  }

  .tab-count {
    font-size: 0.6875rem;
    font-weight: 600;
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }

  .tab-live {
    color: #4ade80;
  }

  .live-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    background: #4ade80;
    border-radius: 50%;
    animation: pulse-live 1.5s ease-in-out infinite;
  }

  @keyframes pulse-live {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }

  .tab-search {
    flex-shrink: 0;
  }

  .search-input {
    width: 240px;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.2);
    color: var(--text);
    font-size: 0.8125rem;
  }

  .search-input::placeholder {
    color: rgba(255, 255, 255, 0.35);
  }

  .search-input:focus {
    outline: none;
    border-color: var(--hover);
  }

  /* Match list */
  .match-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

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
    color: rgba(255, 255, 255, 0.4);
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
    color: rgba(255, 255, 255, 0.3);
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

  .empty-state {
    padding: 3rem 1rem;
    text-align: center;
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.875rem;
    background: rgba(0, 0, 0, 0.15);
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  /* Mobile */
  @media (max-width: 640px) {
    .matches-feed {
      padding: 1rem 0.75rem;
    }

    .feed-title {
      font-size: 1.375rem;
    }

    .tab-bar {
      flex-direction: column;
      align-items: stretch;
    }

    .tab-bar-inner {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }

    .tab-item {
      padding: 0.4375rem 0.75rem;
      font-size: 0.75rem;
    }

    .tab-search {
      width: 100%;
    }

    .search-input {
      width: 100%;
    }

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
