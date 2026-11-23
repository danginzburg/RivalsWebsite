<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import PageHeading from '$lib/components/PageHeading.svelte'
  import { AlertTriangle, ChevronDown } from 'lucide-svelte'
  import MatchCard from '$lib/components/MatchCard.svelte'
  import RecentActivity from '$lib/components/RecentActivity.svelte'
  import { untrack } from 'svelte'
  import ExternalEventsToggle from '$lib/components/ExternalEventsToggle.svelte'
  import { externalEvents } from '$lib/stores/external-events.svelte'

  let { data }: PageProps = $props()
  const allMatches = $derived(data.matches ?? [])
  const hasExternal = $derived(allMatches.some((m) => m.external))
  const matches = $derived(externalEvents.show ? allMatches : allMatches.filter((m) => !m.external))
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
      // completed matches trailing behind. Every group reads newest-first so
      // the whole list is one consistent reverse-chronological timeline —
      // upcoming shouldn't flip to soonest-first and break that order.
      if (activeTab === 'all') {
        const rankDiff = statusRank(a) - statusRank(b)
        if (rankDiff !== 0) return rankDiff
        return playedTime(b) - playedTime(a)
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

  /** Standings position for a team, from its own season's leaderboard. */
  const seeds = $derived((data.seeds ?? {}) as Record<string, number>)

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
    externalEvents.show
    untrack(() => (showAllOnMobile = false))
  })
</script>

<PageContainer>
  <div class="matches-feed">
    <div class="matches-feed-inner">
      <PageHeading title="Matches" subtitle="Upcoming, live, and completed matches." />

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
          {#if hasExternal}
            <ExternalEventsToggle label="External events" />
          {/if}
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
                <MatchCard {match} {seeds} live={isLive(match)} />
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

<style src="./page.css"></style>
