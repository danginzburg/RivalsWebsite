<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { ChevronRight } from 'lucide-svelte'
  import { resolve } from '$app/paths'
  import ExternalEventsToggle from '$lib/components/ExternalEventsToggle.svelte'
  import { externalEvents } from '$lib/stores/external-events.svelte'

  let { data }: PageProps = $props()
  const hideExternal = $derived(!externalEvents.show)
  const allSeasons = $derived(data.seasons ?? [])
  const externalCount = $derived(allSeasons.filter((s) => s.external).length)
  const seasons = $derived(hideExternal ? allSeasons.filter((s) => !s.external) : allSeasons)

  type Season = (typeof allSeasons)[number]

  // Current, then not-yet-started, then finished seasons; empty groups drop out.
  const groups = $derived(
    [
      { label: 'Current', rows: seasons.filter((s) => s.is_active) },
      { label: 'Upcoming', rows: seasons.filter((s) => !s.is_active && s.upcoming) },
      { label: 'Past', rows: seasons.filter((s) => !s.is_active && !s.upcoming) },
    ].filter((g) => g.rows.length > 0)
  )

  function formatRange(startsOn: string | null, endsOn: string | null) {
    if (!startsOn && !endsOn) return 'Dates TBD'
    const date = (d: string) => new Date(`${d}T00:00:00`)
    const fmt = (d: string, withYear = true) =>
      date(d).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        ...(withYear ? { year: 'numeric' } : {}),
      })
    if (startsOn && endsOn) {
      // Drop the first year when both ends share one: "Mar 28 – Jul 5, 2026".
      const sameYear = date(startsOn).getFullYear() === date(endsOn).getFullYear()
      return `${fmt(startsOn, !sameYear)} – ${fmt(endsOn)}`
    }
    return startsOn ? `From ${fmt(startsOn)}` : `Until ${fmt(endsOn!)}`
  }

  // "Season 5" -> "S5", "Shitter League 1" -> "SL1" for seasons without a logo.
  function initials(name: string) {
    const out = name
      .split(' ')
      .map((w) => (/^\d+$/.test(w) ? w : w.charAt(0)))
      .join('')
      .toUpperCase()
    return out.slice(0, 3)
  }

  function matchesLabel(s: Season) {
    if (s.match_count === 0) return null
    return s.completed_count === s.match_count
      ? String(s.match_count)
      : `${s.completed_count}/${s.match_count}`
  }

  function playoffsLabel(s: Season) {
    if (s.playoff_team_count > 0) return `Top ${s.playoff_team_count}`
    return s.has_bracket ? 'Bracket' : null
  }

  // Counts folded into the meta line on narrow screens.
  function compactCounts(s: Season) {
    const parts: string[] = []
    if (s.team_count > 0) parts.push(`${s.team_count} ${s.team_count === 1 ? 'team' : 'teams'}`)
    const m = matchesLabel(s)
    if (m) parts.push(`${m} matches`)
    const p = playoffsLabel(s)
    if (p) parts.push(p === 'Bracket' ? 'Playoff bracket' : `${p} playoffs`)
    return parts.length ? parts.join(' · ') : 'No teams yet'
  }

  function statusText(s: Season) {
    if (s.upcoming) return 'Not started'
    return 'Results not posted yet'
  }
</script>

<svelte:head><title>Events</title></svelte:head>

<PageContainer>
  <div class="page-content py-6">
    <div class="sheet">
      <header class="ev-head">
        <h1 class="ev-title">Events</h1>
        <p class="ev-sub">Every season, its champions, and how it played out.</p>
      </header>

      <div class="ev-bar">
        <span class="ev-bar-note">
          {#if hideExternal && externalCount > 0}
            <b>{seasons.length}</b>
            {seasons.length === 1 ? 'event' : 'events'} · {externalCount} external hidden
          {:else}
            <b>{allSeasons.length}</b>
            {allSeasons.length === 1 ? 'event' : 'events'}{externalCount > 0
              ? ` · ${externalCount} external`
              : ''}
          {/if}
        </span>
        {#if externalCount > 0}
          <ExternalEventsToggle />
        {/if}
      </div>

      <div class="ev-list">
        {#if seasons.length === 0}
          <div class="ev-empty">
            {#if allSeasons.length === 0}
              <p class="ev-empty-title">No seasons yet</p>
              <p class="ev-empty-text">Once a season is created it will appear here.</p>
            {:else}
              <p class="ev-empty-text">Every event is external. Turn the switch on to show them.</p>
            {/if}
          </div>
        {:else}
          <div class="ev-grid ev-th" aria-hidden="true">
            <div class="ev-th-season">Season</div>
            <div class="ev-th-lab"><span class="ev-dot ev-d1"></span>Champion</div>
            <div class="ev-th-lab"><span class="ev-dot ev-d2"></span>Runner-up</div>
            <div class="ev-th-lab"><span class="ev-dot ev-d3"></span>3rd</div>
            <div class="ev-th-lab"><span class="ev-dot ev-d4"></span>MVP</div>
            <div class="ev-r">Teams</div>
            <div class="ev-r">Matches</div>
            <div class="ev-r">Playoffs</div>
            <div></div>
          </div>
          <div class="ev-legend" aria-hidden="true">
            <span><span class="ev-dot ev-d1"></span>Champion</span>
            <span><span class="ev-dot ev-d2"></span>Runner-up</span>
            <span><span class="ev-dot ev-d3"></span>3rd</span>
            <span><span class="ev-dot ev-d4"></span>MVP</span>
          </div>

          {#each groups as group (group.label)}
            <div class="ev-glabel">{group.label}</div>
            {#each group.rows as season (season.id)}
              {@const matches = matchesLabel(season)}
              {@const playoffs = playoffsLabel(season)}
              <div class="ev-grid ev-row">
                {#if season.logo_url}
                  <img src={season.logo_url} alt="" class="ev-logo" />
                {:else}
                  <div class="ev-logo ev-logo-blank" aria-hidden="true">
                    {initials(season.name)}
                  </div>
                {/if}

                <div class="ev-main">
                  <a href={resolve(`/events/${season.code}`)} class="ev-name">{season.name}</a>
                  <div class="ev-meta">
                    {formatRange(season.starts_on, season.ends_on)}<span class="ev-mcounts"
                      >{` · ${compactCounts(season)}`}</span
                    >{#if season.external}<span class="ev-ext">External</span>{/if}
                  </div>
                </div>

                {#if season.winner || season.runner_up || season.third_place || season.mvp}
                  <div class="ev-pod">
                    {#each [{ team: season.winner, cls: 'ev-d1', label: 'Champion' }, { team: season.runner_up, cls: 'ev-d2', label: 'Runner-up' }, { team: season.third_place, cls: 'ev-d3', label: 'Third' }] as place (place.label)}
                      <div class="ev-pc">
                        <span class="ev-dot {place.cls}"></span>
                        {#if place.team}
                          {#if place.team.logo_url}
                            <img src={place.team.logo_url} alt="" />
                          {/if}
                          <span class="ev-nm"
                            ><span class="sr-only">{place.label}: </span>{place.team.name}</span
                          >
                        {:else}
                          <span class="ev-nm ev-none"
                            ><span class="sr-only">{place.label}: </span>—</span
                          >
                        {/if}
                      </div>
                    {/each}
                    <div class="ev-pc">
                      <span class="ev-dot ev-d4"></span>
                      <span class="ev-nm" class:ev-none={!season.mvp}
                        ><span class="sr-only">MVP: </span>{season.mvp?.name ?? '—'}</span
                      >
                    </div>
                  </div>
                {:else}
                  <div class="ev-status" class:ev-status-upcoming={season.upcoming}>
                    {statusText(season)}
                  </div>
                {/if}

                <div class="ev-num" class:ev-dim={season.team_count === 0}>
                  {season.team_count || '—'}
                </div>
                <div class="ev-num" class:ev-dim={!matches}>{matches ?? '—'}</div>
                <div class="ev-num" class:ev-dim={!playoffs}>{playoffs ?? '—'}</div>
                <ChevronRight size={14} class="ev-chev" aria-hidden="true" />
              </div>
            {/each}
          {/each}
        {/if}
      </div>
    </div>
  </div>
</PageContainer>

<style>
  .ev-head {
    background: rgba(255, 255, 255, 0.025);
    padding: 1.375rem 1.5rem 1.125rem;
  }

  .ev-title {
    margin: 0;
    font-size: 1.625rem;
    font-weight: 700;
    line-height: 1.2;
    color: var(--title);
  }

  .ev-sub {
    margin-top: 0.25rem;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.64);
  }

  .ev-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.75rem;
    min-height: 3.25rem;
    padding: 0.25rem 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.025);
  }

  .ev-bar-note {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.6);
  }

  .ev-bar-note b {
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
    font-variant-numeric: tabular-nums;
  }

  .ev-list {
    padding: 0 1.5rem 0.75rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .ev-grid {
    display: grid;
    grid-template-columns:
      40px minmax(170px, 1.25fr) repeat(4, minmax(0, 1fr))
      48px 64px 56px 14px;
    column-gap: 0.875rem;
    align-items: center;
  }

  .ev-th {
    height: 2.25rem;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.5);
  }

  .ev-th-season {
    grid-column: 1 / span 2;
  }

  .ev-th-lab {
    display: flex;
    align-items: center;
    gap: 0.4375rem;
  }

  .ev-r {
    text-align: right;
  }

  .ev-legend {
    display: none;
    flex-wrap: wrap;
    gap: 0.375rem 0.875rem;
    padding: 0.75rem 0 0.25rem;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.5);
  }

  .ev-legend > span {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
  }

  /* One colour per placing, used the same way across the site. */
  .ev-dot {
    width: 6px;
    height: 6px;
    border-radius: 9999px;
    flex-shrink: 0;
  }

  .ev-d1 {
    background: var(--gold);
  }

  .ev-d2 {
    background: #cbd5e1;
  }

  .ev-d3 {
    background: #f0a35e;
  }

  .ev-d4 {
    background: #c084fc;
  }

  .ev-glabel {
    padding: 1rem 0 0.375rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: rgba(255, 255, 255, 0.5);
  }

  .ev-row {
    position: relative;
    min-height: 3.75rem;
    padding: 0.625rem 0.75rem;
    margin: 0 -0.75rem;
    border-radius: 0.625rem;
    transition: background 0.15s;
  }

  .ev-row + .ev-row {
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 0;
  }

  .ev-row:hover {
    background: var(--row-hover);
  }

  .ev-logo {
    width: 40px;
    height: 40px;
    border-radius: 0.5rem;
    object-fit: contain;
    background: rgba(255, 255, 255, 0.04);
  }

  .ev-logo-blank {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: rgba(255, 255, 255, 0.52);
    background: rgba(255, 255, 255, 0.05);
  }

  .ev-main {
    min-width: 0;
  }

  .ev-name {
    display: block;
    font-size: 0.875rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.82);
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ev-name:hover {
    color: #fff;
  }

  /* The name link covers the whole row, so the row stays one link. */
  .ev-name::after {
    content: '';
    position: absolute;
    inset: 0;
  }

  .ev-name:focus-visible {
    outline: none;
  }

  .ev-name:focus-visible::after {
    border-radius: 0.625rem;
    outline: 2px solid #c084fc;
    outline-offset: -2px;
  }

  .ev-meta {
    margin-top: 0.1875rem;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.6);
    /* Wraps rather than clipping the External marker on long date ranges. */
    overflow-wrap: anywhere;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ev-ext {
    margin-left: 0.375rem;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: rgba(255, 255, 255, 0.56);
  }

  .ev-mcounts {
    display: none;
  }

  .ev-pod {
    display: contents;
  }

  .ev-pc {
    display: flex;
    align-items: center;
    gap: 0.4375rem;
    min-width: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.82);
  }

  .ev-pc img {
    width: 18px;
    height: 18px;
    border-radius: 0.25rem;
    object-fit: contain;
    flex-shrink: 0;
  }

  .ev-nm {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ev-none {
    font-weight: 400;
    color: rgba(255, 255, 255, 0.45);
  }

  .ev-status {
    grid-column: 3 / span 4;
    font-size: 0.8125rem;
    /* Season played, results pending. */
    color: var(--gold-text);
    opacity: 0.8;
  }

  .ev-status-upcoming {
    color: var(--teal-text);
  }

  .ev-num {
    text-align: right;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.82);
    font-variant-numeric: tabular-nums;
  }

  .ev-dim {
    color: rgba(255, 255, 255, 0.45);
  }

  :global(.ev-chev) {
    color: rgba(255, 255, 255, 0.42);
  }

  .ev-row:hover :global(.ev-chev) {
    color: var(--accent-text);
  }

  .ev-empty {
    padding: 3rem 0 2.25rem;
    text-align: center;
  }

  .ev-empty-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.82);
  }

  .ev-empty-text {
    margin-top: 0.375rem;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.56);
  }

  /* Below ~1100px the four podium columns get too narrow for team names. */
  @media (max-width: 1100px) {
    .ev-th {
      display: none;
    }

    .ev-legend {
      display: flex;
    }

    .ev-row {
      grid-template-columns: 40px minmax(0, 1fr) 14px;
      row-gap: 0.625rem;
    }

    .ev-pod {
      display: grid;
      grid-column: 2 / span 2;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.5rem 0.875rem;
    }

    .ev-status {
      grid-column: 2 / span 2;
    }

    .ev-num {
      display: none;
    }

    .ev-mcounts {
      display: inline;
    }

    .ev-meta {
      white-space: normal;
    }

    .ev-row :global(.ev-chev) {
      grid-row: 1;
      grid-column: 3;
    }
  }

  @media (max-width: 640px) {
    .ev-head {
      padding: 1.125rem 1rem 1rem;
    }

    .ev-title {
      font-size: 1.375rem;
    }

    .ev-bar {
      padding: 0.25rem 1rem;
    }

    .ev-list {
      padding: 0 1rem 0.625rem;
    }

    .ev-row {
      padding: 0.625rem 0.5rem;
      margin: 0 -0.5rem;
    }

    .ev-pod {
      gap: 0.5rem 0.75rem;
    }

    .ev-pc {
      font-size: 0.75rem;
    }
  }
</style>
