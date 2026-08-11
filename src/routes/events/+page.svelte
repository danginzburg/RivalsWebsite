<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import PageHeading from '$lib/components/PageHeading.svelte'
  import AdminEditLink from '$lib/components/AdminEditLink.svelte'
  import { CalendarClock, Trophy, Crown, Users, Swords, ChevronRight } from 'lucide-svelte'
  import { resolve } from '$app/paths'

  let { data }: PageProps = $props()
  const seasons = $derived(data.seasons ?? [])
  const isAdmin = $derived(data.viewer?.isAdmin ?? false)

  function formatRange(startsOn: string | null, endsOn: string | null) {
    if (!startsOn && !endsOn) return 'Dates TBD'
    const fmt = (d: string) =>
      new Date(`${d}T00:00:00`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    if (startsOn && endsOn) return `${fmt(startsOn)} – ${fmt(endsOn)}`
    return startsOn ? `From ${fmt(startsOn)}` : `Until ${fmt(endsOn!)}`
  }
</script>

<svelte:head><title>Events</title></svelte:head>

<PageContainer>
  <div class="page-content py-6">
    <PageHeading
      title="Events"
      subtitle="Every season, its champions, and how it played out."
      icon={CalendarClock}
    >
      {#snippet actions()}
        {#if isAdmin}
          <AdminEditLink href="/admin?tab=seasons" label="Manage Seasons" />
        {/if}
      {/snippet}
    </PageHeading>

    {#if seasons.length === 0}
      <div class="empty-state">
        <CalendarClock size={40} style="color: rgba(255,255,255,0.25);" />
        <p class="empty-title">No seasons yet</p>
        <p class="empty-text">Once a season is created it will appear here.</p>
      </div>
    {:else}
      <div class="season-list">
        {#each seasons as season (season.id)}
          <a href={resolve(`/events/${season.code}`)} class="season-card">
            {#if season.logo_url}
              <img src={season.logo_url} alt="" class="season-logo" />
            {:else}
              <div class="season-logo season-logo-blank">{season.code?.slice(0, 3) ?? ''}</div>
            {/if}
            <div class="season-main">
              <div class="season-head">
                <div class="season-title-row">
                  <span class="season-code">{season.code}</span>
                  <h2 class="season-name">{season.name}</h2>
                  {#if season.is_active}
                    <span class="badge badge-active">Active</span>
                  {/if}
                </div>
                <p class="season-dates">{formatRange(season.starts_on, season.ends_on)}</p>
              </div>

              {#if season.summary}
                <p class="season-summary">{season.summary}</p>
              {/if}

              <!-- Results -->
              {#if season.winner || season.mvp}
                <div class="results-row">
                  {#if season.winner}
                    <div class="result">
                      <Trophy size={15} style="color: #fcd34d; flex-shrink: 0;" />
                      <span class="result-label">Champion</span>
                      {#if season.winner.logo_url}
                        <img src={season.winner.logo_url} alt="" class="result-logo" />
                      {/if}
                      <span class="result-value">{season.winner.name}</span>
                    </div>
                  {/if}
                  {#if season.runner_up}
                    <div class="result">
                      <span class="result-label">Runner-up</span>
                      <span class="result-value result-value-muted">{season.runner_up.name}</span>
                    </div>
                  {/if}
                  {#if season.mvp}
                    <div class="result">
                      <Crown size={15} style="color: #c084fc; flex-shrink: 0;" />
                      <span class="result-label">MVP</span>
                      <span class="result-value">{season.mvp.name}</span>
                    </div>
                  {/if}
                </div>
              {/if}

              <!-- Stats -->
              <div class="stats-row">
                <span class="stat">
                  <Users size={13} />
                  {season.team_count}
                  {season.team_count === 1 ? 'team' : 'teams'}
                </span>
                <span class="stat">
                  <Swords size={13} />
                  {season.completed_count}/{season.match_count} matches played
                </span>
                {#if season.playoff_team_count > 0}
                  <span class="stat stat-accent">
                    {season.playoff_team_count}-team playoffs
                  </span>
                {:else if season.has_bracket}
                  <span class="stat stat-accent">Playoff bracket</span>
                {/if}
              </div>
            </div>

            <ChevronRight size={18} class="season-arrow" />
          </a>
        {/each}
      </div>
    {/if}
  </div>
</PageContainer>

<style>
  .season-list {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  .season-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.125rem 1.25rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.2);
    text-decoration: none;
    color: var(--text);
    transition:
      border-color 0.15s,
      background 0.15s;
  }

  .season-card:hover {
    border-color: rgba(120, 67, 145, 0.45);
    background: rgba(255, 255, 255, 0.03);
  }

  .season-logo {
    width: 3rem;
    height: 3rem;
    border-radius: 0.5rem;
    object-fit: contain;
    flex-shrink: 0;
    align-self: flex-start;
    background: rgba(255, 255, 255, 0.04);
  }

  .season-logo-blank {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: rgba(255, 255, 255, 0.3);
    background: rgba(255, 255, 255, 0.05);
  }

  .season-main {
    flex: 1;
    min-width: 0;
  }

  .season-title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .season-code {
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--hover);
    background: rgba(120, 67, 145, 0.16);
    padding: 0.1875rem 0.4375rem;
    border-radius: 0.25rem;
  }

  .season-name {
    font-size: 1.0625rem;
    font-weight: 700;
    color: var(--title);
  }

  .badge {
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.1875rem 0.4375rem;
    border-radius: 9999px;
  }

  .badge-active {
    background: rgba(74, 222, 128, 0.16);
    color: #86efac;
  }

  .season-dates {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.45);
    margin-top: 0.1875rem;
  }

  .season-summary {
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.6);
    line-height: 1.5;
    margin-top: 0.5rem;
    max-width: 60ch;
  }

  .results-row {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin-top: 0.75rem;
  }

  .result {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .result-label {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.4);
  }

  .result-logo {
    width: 1.125rem;
    height: 1.125rem;
    border-radius: 0.1875rem;
    object-fit: contain;
  }

  .result-value {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text);
  }

  .result-value-muted {
    font-weight: 500;
    color: rgba(255, 255, 255, 0.65);
  }

  .stats-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.875rem;
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .stat {
    display: inline-flex;
    align-items: center;
    gap: 0.3125rem;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .stat-accent {
    color: var(--hover);
    font-weight: 600;
  }

  :global(.season-arrow) {
    color: rgba(255, 255, 255, 0.25);
    flex-shrink: 0;
  }

  .season-card:hover :global(.season-arrow) {
    color: var(--hover);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    text-align: center;
    padding: 4rem 1.5rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.18);
  }

  .empty-title {
    font-size: 1rem;
    font-weight: 600;
  }

  .empty-text {
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.5);
  }

  @media (max-width: 640px) {
    .season-card {
      padding: 0.875rem 1rem;
      gap: 0.625rem;
    }

    .season-name {
      font-size: 0.9375rem;
    }

    .results-row {
      gap: 0.625rem;
      flex-direction: column;
      align-items: flex-start;
    }

    .stats-row {
      gap: 0.625rem;
    }
  }
</style>
