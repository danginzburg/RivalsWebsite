<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import AdminEditLink from '$lib/components/AdminEditLink.svelte'
  import PageHeading from '$lib/components/PageHeading.svelte'
  import { AlertTriangle, Calendar, ChevronDown } from 'lucide-svelte'
  import TeamSeed from '$lib/components/TeamSeed.svelte'
  import RecentActivity from '$lib/components/RecentActivity.svelte'
  import { resolve } from '$app/paths'
  import { untrack } from 'svelte'

  let { data }: PageProps = $props()
  const matches = $derived(data.matches ?? [])
  const isAdmin = $derived(data.viewer?.isAdmin ?? false)
  const loadFailed = $derived(data.loadFailed ?? false)
  const unreachable = $derived(data.unreachable ?? false)
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
      // Completed tab: most recently played first.
      if (activeTab === 'completed') {
        return playedTime(b) - playedTime(a)
      }

      // All tab groups by state so live and upcoming stay on top, with
      // completed matches trailing behind in reverse-chronological order.
      if (activeTab === 'all') {
        const rankDiff = statusRank(a) - statusRank(b)
        if (rankDiff !== 0) return rankDiff
        if (statusRank(a) === 2) return playedTime(b) - playedTime(a)
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

  /**
   * When the match was actually played.
   *
   * `ended_at` is stamped at the moment an admin marks a match completed, so
   * for a backfilled result it is the data-entry time, not the match date.
   * The scheduled date is the real one; `ended_at` is only a fallback for
   * matches that never had a date set.
   */
  function playedTime(match: any) {
    const value = match.scheduled_at ?? match.ended_at
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

  /** Standings position for a team, from its own season's leaderboard. */
  const seeds = $derived((data.seeds ?? {}) as Record<string, number>)

  function teamSeed(value: unknown): number | null {
    if (!value) return null
    const team = (Array.isArray(value) ? value[0] : value) as { id?: string } | undefined
    return team?.id ? (seeds[team.id] ?? null) : null
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

  const recentComments = $derived(data.recentComments ?? [])

  /**
   * Match cards are tall, so on narrow screens the list is trimmed to keep the
   * discussion feed below it reachable. The cut is made in CSS rather than by
   * slicing the array, so the desktop layout keeps the full list without
   * needing a media query in JS.
   */
  const MOBILE_MATCH_LIMIT = 5
  let showAllOnMobile = $state(false)
  const hiddenOnMobile = $derived(Math.max(0, filteredMatches.length - MOBILE_MATCH_LIMIT))

  // Changing the filter gives a different list, so collapse it again.
  $effect(() => {
    activeTab
    searchQuery
    untrack(() => (showAllOnMobile = false))
  })
</script>

<PageContainer>
  <div class="matches-feed">
    <div class="matches-feed-inner">
      <PageHeading
        title="Matches"
        subtitle="Upcoming, live, and completed matches."
        icon={Calendar}
      >
        {#snippet actions()}
          {#if isAdmin}
            <AdminEditLink href="/admin?tab=matches" label="Manage Matches" />
          {/if}
        {/snippet}
      </PageHeading>

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

      <div class="feed-layout">
        <aside class="feed-aside">
          <RecentActivity comments={recentComments} />
        </aside>

        <div class="feed-main">
          <!-- Match list -->
          {#if loadFailed}
            <!-- Never show "no matches" for a failed load; that reads as an empty
             league rather than a temporary outage. -->
            <div class="error-state">
              <AlertTriangle size={22} />
              <div>
                <p class="error-title">
                  {unreachable ? "Couldn't reach the server" : 'Failed to load matches'}
                </p>
                <p class="error-text">
                  {unreachable
                    ? 'The connection timed out. This is usually temporary — try again in a moment.'
                    : 'Something went wrong loading the schedule.'}
                </p>
              </div>
              <button type="button" class="retry-btn" onclick={() => location.reload()}>
                Retry
              </button>
            </div>
          {:else if filteredMatches.length === 0}
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
            <div class="match-list" class:match-list-collapsed={!showAllOnMobile}>
              {#each filteredMatches as match (match.id)}
                <a href={resolve(`/matches/${match.id}`)} class="match-card">
                  {#if match.designation}
                    <div class="designation">{match.designation}</div>
                  {/if}
                  <div class="match-teams">
                    <div class="match-team">
                      <TeamSeed seed={teamSeed(match.team_a)} label="Leaderboard rank" />
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
                      <TeamSeed seed={teamSeed(match.team_b)} label="Leaderboard rank" />
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

            {#if !showAllOnMobile && hiddenOnMobile > 0}
              <button type="button" class="show-more" onclick={() => (showAllOnMobile = true)}>
                <span>Show {hiddenOnMobile} more {hiddenOnMobile === 1 ? 'match' : 'matches'}</span>
                <ChevronDown size={15} />
              </button>
            {/if}
          {/if}
        </div>
      </div>
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
    color: rgba(255, 255, 255, 0.56);
  }

  .search-input:focus {
    outline: none;
    border-color: var(--hover);
  }

  /* Feed layout: discussion pinned on the left, matches filling the rest. */
  .feed-layout {
    display: grid;
    grid-template-columns: 20rem minmax(0, 1fr);
    gap: 1.5rem;
    align-items: start;
  }

  .feed-main {
    min-width: 0;
  }

  .feed-aside {
    position: sticky;
    top: 4.5rem;
    min-width: 0;
  }

  /* Match list */
  .match-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .show-more {
    display: none;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    width: 100%;
    margin-top: 0.5rem;
    padding: 0.625rem 1rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.2);
    color: rgba(255, 255, 255, 0.75);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
  }

  .show-more:hover {
    background: rgba(255, 255, 255, 0.05);
    color: var(--text);
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

  .error-state {
    display: flex;
    align-items: center;
    gap: 0.875rem;
    padding: 1.25rem;
    border-radius: 0.625rem;
    border: 1px solid rgba(248, 113, 113, 0.28);
    background: rgba(248, 113, 113, 0.07);
    color: #fca5a5;
  }

  .error-title {
    font-size: 0.875rem;
    font-weight: 700;
    color: #fecaca;
  }

  .error-text {
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.55);
    margin-top: 0.125rem;
    line-height: 1.45;
  }

  .retry-btn {
    margin-left: auto;
    flex-shrink: 0;
    padding: 0.4375rem 1rem;
    border-radius: 0.4375rem;
    border: 1px solid rgba(248, 113, 113, 0.3);
    background: transparent;
    color: #fca5a5;
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  .retry-btn:hover {
    background: rgba(248, 113, 113, 0.14);
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

  /* The sidebar stops fitting well before the phone breakpoint. */
  @media (max-width: 1024px) {
    .feed-layout {
      grid-template-columns: minmax(0, 1fr);
      gap: 1.25rem;
    }

    /* Stacked, the matches come first and the discussion sits underneath. */
    .feed-aside {
      position: static;
      order: 1;
    }

    .feed-main {
      order: 0;
    }
  }

  /* Narrow screens: trim the match list so the discussion feed stays reachable. */
  @media (max-width: 900px) {
    /* Keep in step with MOBILE_MATCH_LIMIT: n + (limit + 1). */
    .match-list-collapsed > :nth-child(n + 6) {
      display: none;
    }

    .show-more {
      display: flex;
    }
  }

  /* Mobile */
  @media (max-width: 640px) {
    .matches-feed {
      padding: 1rem 0.75rem;
    }

    .tab-bar {
      flex-direction: column;
      align-items: stretch;
    }

    .tab-bar-inner {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      /*
       * `.tab-bar` still carries `flex-wrap: wrap`, and a wrapping column flex
       * sizes its line to the widest item rather than to the container — so the
       * strip stretched to its content width and ran past the page padding
       * instead of scrolling. Pin it to the container and let it scroll.
       */
      min-width: 0;
      max-width: 100%;
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
