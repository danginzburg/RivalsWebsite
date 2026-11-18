<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { Search, Lock } from 'lucide-svelte'
  import ArchiveBracket from '$lib/components/ArchiveBracket.svelte'
  import StandingsZonesEditor from '$lib/components/StandingsZonesEditor.svelte'
  import { resolve } from '$app/paths'
  import {
    EMPTY_STANDINGS_CONFIG,
    ZONE_TONE_COLORS,
    zoneForTeam,
    zoneRangeLabel,
    type StandingsZone,
  } from '$lib/seasons/standingsZones'

  let { data }: PageProps = $props()

  const rows = $derived(data.rows ?? [])
  // The page is scoped to the running season; between seasons there is none.
  const season = $derived(data.season ?? null)
  const myTeam = $derived(data.myTeam ?? null)
  const seeds = $derived((data.seeds ?? {}) as Record<string, number>)
  const zones = $derived(data.zones ?? EMPTY_STANDINGS_CONFIG)
  const bracket = $derived(data.bracket ?? null)
  const isAdmin = $derived(data.viewer?.isAdmin ?? false)
  const asOf = $derived(data.batch?.as_of_date ?? null)

  let editingZones = $state(false)
  let search = $state('')

  type Row = (typeof rows)[number]
  /** A row that has an entry in the current standings. */
  type RankedRow = Row & { stats: NonNullable<Row['stats']> }

  const q = $derived(search.trim().toLowerCase())

  const allRanked = $derived(rows.filter((r): r is RankedRow => r.stats != null))
  const ranked = $derived(
    q
      ? allRanked.filter((r) =>
          [r.name, r.tag, r.org].filter(Boolean).join(' ').toLowerCase().includes(q)
        )
      : allRanked
  )

  const myRank = $derived(
    myTeam ? (allRanked.find((r) => r.id === myTeam.id)?.stats.rank ?? null) : null
  )

  /**
   * Standings grouped by zone, in zone order: each group gets one small label
   * row instead of a coloured stripe on every row. Teams outside every zone
   * (or a season with no zones) fall into an unlabelled group.
   */
  type Group = {
    zone: StandingsZone | null
    dim: boolean
    rows: (RankedRow & { locked: boolean })[]
  }
  const groups = $derived.by<Group[]>(() => {
    const byZone = new Map<string | null, Group>()
    const lastZone = zones.zones.at(-1)
    // Only an open-ended bottom zone reads as "out"; dimming a lone zone would dim everything.
    const dimId = zones.zones.length > 1 && lastZone?.to == null ? lastZone?.id : undefined
    for (const zone of zones.zones) byZone.set(zone.id, { zone, dim: zone.id === dimId, rows: [] })
    byZone.set(null, { zone: null, dim: false, rows: [] })
    for (const row of ranked) {
      const placed = zoneForTeam(zones, row.id, row.stats.rank)
      byZone.get(placed.zone?.id ?? null)!.rows.push({ ...row, locked: placed.locked })
    }
    return [...byZone.values()].filter((g) => g.rows.length > 0)
  })

  function ordinal(n: number) {
    const suffix = ['th', 'st', 'nd', 'rd']
    const v = n % 100
    return n + (suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0])
  }

  const asOfLabel = $derived(
    asOf
      ? new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(String(asOf)))
      : null
  )

  const metaLine = $derived(
    [
      asOfLabel ? `Standings as of ${asOfLabel}` : 'Standings',
      allRanked.length ? `${allRanked.length} teams` : null,
      bracket ? 'Playoffs in progress' : null,
    ]
      .filter(Boolean)
      .join(' · ')
  )

  const playoffNote = $derived.by(() => {
    if (!bracket) return ''
    const total = bracket.slots.length
    const played = bracket.slots.filter((s) => s.winnerId).length
    const teamCount = Object.keys(seeds).length
    return [
      'Double elimination',
      teamCount ? `${teamCount} teams` : null,
      played === total ? 'Complete' : `${played} of ${total} series played`,
    ]
      .filter(Boolean)
      .join(' · ')
  })

  const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0')
</script>

<svelte:head><title>Leaderboard</title></svelte:head>

<PageContainer>
  <div class="page-content py-6">
    <article class="sheet">
      <header class="lb-head">
        <div class="min-w-0">
          {#if season?.name}<div class="lb-eyebrow">{season.name}</div>{/if}
          <h1 class="lb-title">Leaderboard</h1>
          {#if season}<p class="lb-meta">{metaLine}</p>{/if}
        </div>
        {#if myTeam}
          <a href={resolve(`/teams/${myTeam.id}`)} class="my-team">
            <span class="lb-label">Your team</span>
            {#if myTeam.logo_url}<img src={myTeam.logo_url} alt="" class="my-team-logo" />{/if}
            <span class="my-team-name">{myTeam.name}</span>
            {#if myRank != null}<span class="my-team-rank">{ordinal(myRank)}</span>{/if}
          </a>
        {/if}
      </header>

      {#if !season}
        <!-- Off-season: no standings, no roster, nothing to search. -->
        <div class="lb-empty sheet-section">
          <p class="lb-empty-title">No season in progress</p>
          <p>
            Standings and teams appear here once the next season starts. Past seasons are on the
            <a href={resolve('/events')}>events page</a>.
          </p>
        </div>
      {:else}
        <div class="lb-bar">
          <label class="lb-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              bind:value={search}
              placeholder="Search teams"
              aria-label="Search teams"
            />
          </label>
          {#if isAdmin && !editingZones}
            <button type="button" class="zones-btn" onclick={() => (editingZones = true)}>
              Edit zones
            </button>
          {/if}
        </div>

        {#if isAdmin && editingZones}
          <div class="sheet-section sheet-body">
            <StandingsZonesEditor
              seasonId={season.id}
              config={zones}
              teams={allRanked.map((r) => ({ id: r.id, name: r.name, rank: r.stats.rank ?? null }))}
              onClose={() => (editingZones = false)}
            />
          </div>
        {/if}

        {#if bracket}
          <section class="sheet-section" aria-labelledby="playoffs-title">
            <div class="sheet-head">
              <h2 class="sheet-title" id="playoffs-title">Playoffs</h2>
              <span class="sheet-note">{playoffNote}</span>
            </div>
            <div class="sheet-body">
              <ArchiveBracket
                slots={bracket.slots}
                teams={bracket.teams}
                {seeds}
                matchIds={bracket.matchIds}
                series={bracket.series}
                query={search}
                myTeamId={myTeam?.id ?? null}
              />
            </div>
          </section>
        {/if}

        <section class="sheet-section" aria-labelledby="standings-title">
          <div class="sheet-head">
            <h2 class="sheet-title" id="standings-title">Standings</h2>
            <span class="sheet-note">Regular season · ties broken by round differential</span>
          </div>

          {#if rows.length === 0}
            <p class="lb-empty">Approved teams and their standings will appear here.</p>
          {:else if allRanked.length === 0}
            <p class="lb-empty">No standings yet.</p>
          {:else if ranked.length === 0}
            <p class="lb-empty">No teams match “{search}”.</p>
          {:else}
            <div class="table-wrap">
              <table class="standings">
                <thead>
                  <tr>
                    <th class="col-rank">#</th>
                    <th class="col-team">Team</th>
                    <th class="col-num col-seed">Seed</th>
                    {#if season.showPoints}<th class="col-num">Pts</th>{/if}
                    <th class="col-num">Series</th>
                    <th class="col-num col-maps">Maps</th>
                    <th class="col-num" title="Round differential, used to break ties">RD</th>
                  </tr>
                </thead>
                {#each groups as group (group.zone?.id ?? 'none')}
                  <tbody
                    class:dim={group.dim}
                    style={group.zone
                      ? `--zone-color: ${ZONE_TONE_COLORS[group.zone.tone]};`
                      : undefined}
                  >
                    {#if group.zone}
                      <tr class="zone-row">
                        <td colspan="7">
                          <span class="zone-label">
                            <span class="zone-dot"></span>
                            {group.zone.label}
                            <span class="zone-range">{zoneRangeLabel(group.zone)}</span>
                          </span>
                        </td>
                      </tr>
                    {/if}
                    {#each group.rows as row (row.id)}
                      <tr class:row-mine={myTeam?.id === row.id}>
                        <!-- No rank until the season's first import. -->
                        <td class="col-rank" class:zoned={group.zone != null}>
                          {row.stats.rank ?? '—'}
                        </td>
                        <td class="col-team">
                          <a href={resolve(`/teams/${row.id}`)} class="team-cell">
                            {#if row.logo_url}
                              <img src={row.logo_url} alt="" class="team-logo" />
                            {:else}
                              <span class="team-logo team-logo-blank"></span>
                            {/if}
                            <span class="team-name">{row.name}</span>
                            {#if row.tag}
                              <span class="team-tag">{String(row.tag).toUpperCase()}</span>
                            {/if}
                            {#if row.locked}
                              <span
                                class="team-locked"
                                title="Locked in: decided regardless of rank"
                              >
                                <Lock size={10} aria-hidden="true" /> Locked
                              </span>
                            {/if}
                          </a>
                        </td>
                        <td class="col-num col-seed muted">{seeds[row.id] ?? '–'}</td>
                        {#if season.showPoints}
                          <td class="col-num col-points">{row.stats.points}</td>
                        {/if}
                        <td class="col-num" title="{row.stats.series_played} played">
                          {row.stats.series_wins}–{row.stats.series_losses}
                        </td>
                        <td class="col-num col-maps" title="{row.stats.maps_played} played">
                          {row.stats.map_wins}–{row.stats.map_losses}
                        </td>
                        <td
                          class="col-num"
                          class:rd-pos={row.stats.round_diff > 0}
                          class:rd-neg={row.stats.round_diff < 0}
                        >
                          {signed(row.stats.round_diff)}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                {/each}
              </table>
            </div>
          {/if}
        </section>
      {/if}
    </article>
  </div>
</PageContainer>

<style>
  /* Header: the top of the sheet */
  .lb-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    padding: 1.5rem 1.5rem 1.125rem;
  }

  .lb-eyebrow {
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent-text);
  }

  .lb-title {
    margin: 0.375rem 0 0;
    font-size: 1.75rem;
    line-height: 1.1;
    font-weight: 700;
    color: var(--text);
  }

  .lb-meta {
    margin: 0.5rem 0 0;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.66);
  }

  .lb-label {
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.55);
  }

  .my-team {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.75rem;
    padding: 0 0.625rem;
    border-radius: 0.5rem;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.82);
    text-decoration: none;
  }

  .my-team:hover {
    background: rgba(255, 255, 255, 0.04);
    color: var(--text);
  }

  .my-team-logo {
    width: 1.375rem;
    height: 1.375rem;
    border-radius: 0.25rem;
    object-fit: contain;
  }

  .my-team-name {
    font-weight: 600;
  }

  .my-team-rank {
    color: rgba(255, 255, 255, 0.55);
  }

  /* Search bar, docked under the header */
  .lb-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.625rem;
    padding: 0.625rem 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .lb-search {
    position: relative;
    display: flex;
    align-items: center;
    flex: 1 1 16rem;
    max-width: 21rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .lb-search :global(svg) {
    position: absolute;
    left: 0.6875rem;
    pointer-events: none;
  }

  .lb-search input {
    width: 100%;
    height: 2.375rem;
    padding: 0 0.75rem 0 2.125rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.18);
    color: var(--text);
    font-size: 0.8125rem;
  }

  .lb-search input::placeholder {
    color: rgba(255, 255, 255, 0.5);
  }

  .lb-search input:focus {
    outline: none;
    border-color: rgba(192, 132, 252, 0.6);
  }

  .zones-btn {
    margin-left: auto;
    height: 2.375rem;
    padding: 0 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
  }

  .zones-btn:hover {
    border-color: rgba(255, 255, 255, 0.18);
    color: var(--text);
  }

  /* Standings */
  .table-wrap {
    overflow-x: auto;
    padding-bottom: 0.75rem;
  }

  .standings {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }

  .standings th {
    height: 2rem;
    padding: 0 0.5rem;
    text-align: right;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: rgba(255, 255, 255, 0.5);
    white-space: nowrap;
  }

  .standings td {
    height: 2.25rem;
    padding: 0 0.5rem;
    color: rgba(255, 255, 255, 0.82);
    white-space: nowrap;
  }

  .standings th:first-child,
  .standings td:first-child {
    padding-left: 1.5rem;
  }

  .standings th:last-child,
  .standings td:last-child {
    padding-right: 1.5rem;
  }

  .standings tbody tr:not(.zone-row):hover {
    background: rgba(255, 255, 255, 0.025);
  }

  .standings th.col-rank,
  .standings th.col-team {
    text-align: left;
  }

  .standings .col-rank {
    width: 2.75rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.5);
    font-variant-numeric: tabular-nums;
  }

  .col-team {
    width: 100%;
    max-width: 0;
  }

  .col-num {
    text-align: right;
    min-width: 3.25rem;
    font-variant-numeric: tabular-nums;
  }

  .standings .col-points {
    font-weight: 700;
    color: var(--text);
  }

  .standings .muted {
    color: rgba(255, 255, 255, 0.55);
  }

  /* Zones: one label row per group, a hairline above it, colour only on the dot. */
  .standings .zone-row td {
    height: auto;
    padding-top: 0.875rem;
    padding-bottom: 0.375rem;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .zone-label {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--zone-color) 80%, white);
  }

  .zone-dot {
    width: 0.375rem;
    height: 0.375rem;
    border-radius: 9999px;
    background: var(--zone-color);
  }

  /* A thin zone-coloured marker on each rank, so the cut lines read at a glance. */
  .standings td.zoned {
    box-shadow: inset 2px 0 0 color-mix(in srgb, var(--zone-color) 70%, transparent);
  }

  .standings td.rd-pos {
    color: var(--good);
  }

  .standings td.rd-neg {
    color: var(--bad);
  }

  .standings tbody.dim td.rd-pos,
  .standings tbody.dim td.rd-neg {
    opacity: 0.75;
  }

  .zone-range {
    font-weight: 600;
    letter-spacing: 0.04em;
    color: rgba(255, 255, 255, 0.45);
  }

  /* The open-ended bottom zone (e.g. eliminated) steps back. */
  .standings tbody.dim tr:not(.zone-row) td:not(.rd-pos):not(.rd-neg) {
    color: rgba(255, 255, 255, 0.55);
  }

  .standings tbody.dim .team-name {
    color: rgba(255, 255, 255, 0.62);
  }

  .standings tbody.dim .team-logo {
    opacity: 0.7;
  }

  .standings tbody.dim td.col-points {
    color: rgba(255, 255, 255, 0.7);
  }

  /* The viewer's team: accent means "you". */
  .row-mine {
    background: rgba(192, 132, 252, 0.07);
  }

  .standings .row-mine .team-name {
    color: var(--accent-text);
  }

  .team-cell {
    display: flex;
    align-items: center;
    gap: 0.5625rem;
    min-width: 0;
    text-decoration: none;
    color: inherit;
  }

  .team-logo {
    width: 1.375rem;
    height: 1.375rem;
    border-radius: 0.25rem;
    object-fit: contain;
    flex-shrink: 0;
  }

  .team-logo-blank {
    background: rgba(255, 255, 255, 0.06);
  }

  .team-name {
    font-weight: 600;
    color: rgba(255, 255, 255, 0.82);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .team-cell:hover .team-name {
    color: var(--accent-text);
  }

  .team-tag {
    flex-shrink: 0;
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .team-locked {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.5);
  }

  /* Empty */
  .lb-empty {
    padding: 1.5rem;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.55);
  }

  .lb-empty-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 0.375rem;
  }

  .lb-empty a {
    color: var(--accent-text);
  }

  @media (max-width: 640px) {
    .lb-head {
      padding: 1.125rem 0.875rem 0.875rem;
    }

    .lb-title {
      font-size: 1.5rem;
    }

    .my-team {
      padding: 0;
    }

    .lb-bar {
      padding: 0.625rem 0.875rem;
    }

    .lb-search {
      max-width: none;
    }

    .standings th,
    .standings td {
      padding-left: 0.375rem;
      padding-right: 0.375rem;
    }

    .standings th:first-child,
    .standings td:first-child {
      padding-left: 0.875rem;
    }

    .standings th:last-child,
    .standings td:last-child {
      padding-right: 0.875rem;
    }

    .col-seed,
    .col-maps,
    .team-tag {
      display: none;
    }

    .standings .col-rank {
      width: 1.75rem;
    }

    .col-num {
      min-width: 2.5rem;
    }
  }
</style>
