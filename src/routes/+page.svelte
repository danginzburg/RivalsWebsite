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
              <MatchCard {match} {seeds} />
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

<style>
  .home {
    display: flex;
    flex-direction: column;
    gap: 1.75rem;
    width: 100%;
    max-width: 80rem;
    padding: 0.5rem 0 3rem;
  }

  .error-state {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.875rem 1.125rem;
    border-radius: 0.625rem;
    border: 1px solid rgba(248, 113, 113, 0.28);
    background: rgba(248, 113, 113, 0.07);
    color: #fca5a5;
    font-size: 0.875rem;
  }

  .home-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 22rem;
    gap: 1.5rem;
  }

  /*
   * The discussion panel takes its height from the schedule column rather than
   * its own content, so both columns end on the same line above the Discord
   * band. Extra comments scroll inside the panel.
   */
  .home-side {
    position: relative;
    min-width: 0;
  }

  .home-side-fill {
    position: absolute;
    inset: 0;
  }

  .home-section {
    min-width: 0;
  }

  .section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }

  .section-head h2 {
    color: var(--heading);
    font-size: 1.125rem;
    font-weight: 700;
  }

  .section-link {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--accent-text);
    text-decoration: none;
    white-space: nowrap;
  }

  .section-link:hover {
    text-decoration: underline;
  }

  .section-subhead {
    margin: 1.25rem 0 0.75rem;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .match-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .empty {
    padding: 2.5rem 1rem;
    text-align: center;
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.5);
    border-radius: 0.625rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(0, 0, 0, 0.15);
  }

  .discord-band {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.25rem;
    flex-wrap: wrap;
    padding: 1.5rem 1.75rem;
    border-radius: 1rem;
    border: 1px solid rgba(88, 101, 242, 0.3);
    background: linear-gradient(120deg, rgba(88, 101, 242, 0.16), rgba(81, 47, 138, 0.2));
  }

  .discord-band h2 {
    color: var(--heading);
    font-size: 1.125rem;
    font-weight: 700;
  }

  .discord-band p {
    margin-top: 0.25rem;
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.65);
  }

  .discord-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6875rem 1.125rem;
    border-radius: 0.625rem;
    background: #5865f2;
    color: #fff;
    font-size: 0.875rem;
    font-weight: 700;
    text-decoration: none;
    transition: background 0.15s;
  }

  .discord-btn:hover {
    background: #4752c4;
  }

  @media (max-width: 1024px) {
    .home-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    /* Stacked, the panel sizes to its comments up to a cap, then scrolls. */
    .home-side-fill {
      position: static;
      display: flex;
      flex-direction: column;
      max-height: 30rem;
    }

    .home-side-fill > :global(*) {
      min-height: 0;
    }
  }

  @media (max-width: 480px) {
    .discord-btn {
      width: 100%;
      justify-content: center;
    }
  }
</style>
