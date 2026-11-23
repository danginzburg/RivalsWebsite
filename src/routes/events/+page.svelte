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

<style src="./page.css"></style>
