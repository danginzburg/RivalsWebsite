<script lang="ts">
  import type { PageProps } from './$types'
  import { resolve } from '$app/paths'
  import { AlertTriangle, ArrowRight } from 'lucide-svelte'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import HomeHero from '$lib/components/home/HomeHero.svelte'
  import MatchCard from '$lib/components/MatchCard.svelte'
  import RecentActivity from '$lib/components/RecentActivity.svelte'
  import DiscordIcon from '$lib/components/icons/DiscordIcon.svelte'

  let { data }: PageProps = $props()

  const seeds = $derived((data.seeds ?? {}) as Record<string, number>)

  /**
   * A match that has reached its start time still reads as "scheduled" until
   * an admin edits it, so live is derived from the clock — same rule as the
   * /matches feed. Ticks so the hero flips to live and the countdown moves.
   */
  let now = $state(Date.now())
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 15_000)
    return () => clearInterval(id)
  })

  function isLive(match: { status: string; scheduled_at: string | null }) {
    if (match.status === 'live') return true
    return match.scheduled_at != null && Date.parse(match.scheduled_at) <= now
  }

  const liveMatch = $derived(data.upcoming.find(isLive) ?? null)
  const nextMatch = $derived(data.upcoming.find((m) => !isLive(m)) ?? null)

  /** Below this many upcoming matches, recent results fill out the column. */
  const MIN_UPCOMING = 3

  /** Live first, then the soonest few. The hero already features one of them. */
  const upNext = $derived(
    [...data.upcoming.filter(isLive), ...data.upcoming.filter((m) => !isLive(m))].slice(0, 5)
  )
  const showResults = $derived(upNext.length < MIN_UPCOMING)
</script>

<svelte:head>
  <title>TC Rivals</title>
</svelte:head>

<PageContainer>
  <div class="home">
    {#if data.unreachable}
      <div class="error-state">
        <AlertTriangle size={20} />
        <p>Couldn't reach the server — some of this page may be missing. Try again in a moment.</p>
      </div>
    {/if}

    <HomeHero
      season={data.season}
      upcomingSignup={data.upcomingSignup}
      signupsOpen={data.signupsOpen ?? false}
      rulebookPublished={data.rulebookPublished ?? false}
      hasActivePickem={data.hasActivePickem ?? false}
      {liveMatch}
      {nextMatch}
      latestResult={data.recentResults[0] ?? null}
      {seeds}
      logos={data.heroLogos}
      stats={data.stats}
      {now}
    />

    <div class="home-grid">
      <section class="home-section home-schedule">
        <header class="section-head">
          <h2>{upNext.length > 0 ? 'Up next' : 'Latest results'}</h2>
          <a href={resolve('/matches')} class="section-link">
            Full schedule <ArrowRight size={14} />
          </a>
        </header>

        {#if upNext.length > 0}
          <div class="match-list">
            {#each upNext as match (match.id)}
              <MatchCard {match} {seeds} live={isLive(match)} />
            {/each}
          </div>
        {/if}

        {#if showResults && data.recentResults.length > 0}
          {#if upNext.length > 0}
            <h3 class="section-subhead">Latest results</h3>
          {/if}
          <div class="match-list">
            {#each data.recentResults as match (match.id)}
              <MatchCard {match} {seeds} />
            {/each}
          </div>
        {:else if upNext.length === 0}
          <p class="empty">No matches scheduled yet.</p>
        {/if}
      </section>

      <aside class="home-side">
        <div class="home-side-fill">
          <RecentActivity comments={data.recentComments} fill />
        </div>
      </aside>
    </div>

    <section class="discord-band">
      <div>
        <h2>Join the community</h2>
        <p>Scrims, signups, announcements, and match-day chatter all happen on Discord.</p>
      </div>
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
      <a
        href="https://discord.gg/JpTYg2662C"
        target="_blank"
        rel="noopener noreferrer"
        class="discord-btn"
      >
        <DiscordIcon size={18} /> Join the Discord
      </a>
    </section>
  </div>
</PageContainer>

<style src="./page.css"></style>
