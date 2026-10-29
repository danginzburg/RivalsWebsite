<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import PageHeading from '$lib/components/PageHeading.svelte'
  import { Trophy, Search, ChevronRight, Lock, SlidersHorizontal } from 'lucide-svelte'
  import TeamSeed from '$lib/components/TeamSeed.svelte'
  import ArchiveBracket from '$lib/components/ArchiveBracket.svelte'
  import StandingsZonesEditor from '$lib/components/StandingsZonesEditor.svelte'
  import { resolve } from '$app/paths'
  import {
    EMPTY_STANDINGS_CONFIG,
    ZONE_TONE_COLORS,
    zoneForTeam,
    zoneRangeLabel,
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
  /** A published bracket to draw: the bracket leads and the table steps back. */
  const inPlayoffs = $derived(bracket != null)

  let editingZones = $state(false)

  type Row = (typeof rows)[number]
  /** A row that has an entry in the current standings. */
  type RankedRow = Row & { stats: NonNullable<Row['stats']> }

  let search = $state('')

  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      [r.name, r.tag, r.org].filter(Boolean).join(' ').toLowerCase().includes(q)
    )
  })

  // Type predicates so the table can read `row.stats` without a null check.
  const ranked = $derived(filtered.filter((r): r is RankedRow => r.stats != null))

  /** The ranks zones end on, for drawing a cutoff line under those rows. */
  const zoneEnds = $derived(
    new Set(zones.zones.map((z) => z.to).filter((to): to is number => to != null))
  )

  /** Medal colouring for the top three. */
  function rankStyle(rank: number | null) {
    if (rank === 1) return 'background: rgba(252,211,77,0.16); color: #fcd34d;'
    if (rank === 2) return 'background: rgba(203,213,225,0.16); color: #cbd5e1;'
    if (rank === 3) return 'background: rgba(217,119,6,0.18); color: #fbbf24;'
    return 'background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.55);'
  }
</script>

<svelte:head><title>Leaderboard</title></svelte:head>

<PageContainer>
  <div class="page-content py-6">
    <PageHeading
      title="Leaderboard"
      subtitle={season?.name ? `${season.name} standings` : 'Standings'}
      icon={Trophy}
    ></PageHeading>

    {#if !season}
      <!-- Off-season: no standings, no roster, nothing to search. -->
      <div class="empty-state">
        <Trophy size={40} style="color: rgba(255,255,255,0.48);" />
        <p class="empty-title">No season in progress</p>
        <p class="empty-text">
          Standings and teams appear here once the next season starts. Past seasons are on the
          <a href={resolve('/events')} class="empty-link">events page</a>.
        </p>
      </div>
    {:else}
      <!-- Viewer's own team -->
      {#if myTeam}
        <a href={resolve(`/teams/${myTeam.id}`)} class="my-team">
          {#if myTeam.logo_url}
            <img src={myTeam.logo_url} alt="" class="my-team-logo" />
          {:else}
            <div class="my-team-logo my-team-logo-blank"></div>
          {/if}
          <div class="my-team-body">
            <div class="my-team-label">Your team</div>
            <div class="my-team-name">
              {myTeam.name}{#if myTeam.tag}<span class="my-team-tag"
                  >[{String(myTeam.tag).toUpperCase()}]</span
                >{/if}
            </div>
            {#if myTeam.role}
              <div class="my-team-role">{myTeam.role}</div>
            {/if}
          </div>
          <ChevronRight size={18} class="my-team-arrow" />
        </a>
      {/if}

      <!-- Search -->
      <div class="toolbar">
        <div class="search-wrap">
          <span class="search-icon"><Search size={14} /></span>
          <input bind:value={search} class="search-input" placeholder="Search teams..." />
        </div>
        {#if isAdmin && !editingZones}
          <button type="button" class="zones-btn" onclick={() => (editingZones = true)}>
            <SlidersHorizontal size={14} /> Edit zones
          </button>
        {/if}
      </div>

      {#if isAdmin && editingZones}
        <StandingsZonesEditor
          seasonId={season.id}
          config={zones}
          teams={rows
            .filter((r) => r.stats != null)
            .map((r) => ({ id: r.id, name: r.name, rank: r.stats?.rank ?? null }))}
          onClose={() => (editingZones = false)}
        />
      {/if}

      {#if inPlayoffs && bracket}
        <section class="bracket-block">
          <h2 class="playoffs-title">
            <Trophy size={18} class="playoffs-icon" />
            Playoffs
          </h2>
          <ArchiveBracket slots={bracket.slots} teams={bracket.teams} {seeds} />
        </section>
        <h2 class="section-title">Regular season standings</h2>
      {/if}

      {#if rows.length === 0}
        <div class="empty-state">
          <Trophy size={40} style="color: rgba(255,255,255,0.48);" />
          <p class="empty-title">No teams yet</p>
          <p class="empty-text">Approved teams and their standings will appear here.</p>
        </div>
      {:else if filtered.length === 0}
        <div class="empty-state">
          <p class="empty-text">No teams match “{search}”.</p>
        </div>
      {:else}
        <!-- Standings -->
        {#if ranked.length > 0}
          {#if zones.zones.length > 0}
            <div class="zone-legend">
              {#each zones.zones as zone (zone.id)}
                <span class="zone-key">
                  <span class="zone-dot" style="background: {ZONE_TONE_COLORS[zone.tone]};"></span>
                  {zone.label}
                  <span class="zone-range">{zoneRangeLabel(zone)}</span>
                </span>
              {/each}
              {#if Object.keys(zones.locked).length > 0}
                <span class="zone-key zone-key-lock"><Lock size={11} /> Locked in</span>
              {/if}
            </div>
          {/if}
          <div class="table-wrap" class:table-compact={inPlayoffs}>
            <table class="standings">
              <thead>
                <tr>
                  <th class="col-rank">#</th>
                  <th class="col-team">Team</th>
                  {#if season?.showPoints}<th class="col-num">Pts</th>{/if}
                  <th class="col-num">Series</th>
                  <th class="col-num">W</th>
                  <th class="col-num">L</th>
                  <th class="col-num">Maps</th>
                  <th class="col-num">MW</th>
                  <th class="col-num">ML</th>
                  <th class="col-num" title="Round differential — used to break ties">RD</th>
                </tr>
              </thead>
              <tbody>
                {#each ranked as row (row.id)}
                  {@const isMine = myTeam?.id === row.id}
                  {@const placed = zoneForTeam(zones, row.id, row.stats.rank)}
                  <tr
                    class:row-mine={isMine}
                    class:zone-cut={!search.trim() &&
                      row.stats.rank != null &&
                      zoneEnds.has(row.stats.rank)}
                    style={placed.zone
                      ? `--zone-color: ${ZONE_TONE_COLORS[placed.zone.tone]};`
                      : undefined}
                  >
                    <td class="col-rank" class:zoned={placed.zone != null}>
                      <span class="rank-badge" style={rankStyle(row.stats.rank)}>
                        <!-- No rank until the season's first import. -->
                        {row.stats.rank ?? '—'}
                      </span>
                    </td>
                    <td class="col-team">
                      <a href={resolve(`/teams/${row.id}`)} class="team-cell">
                        {#if row.logo_url}
                          <img src={row.logo_url} alt="" class="team-logo" />
                        {:else}
                          <div class="team-logo team-logo-blank"></div>
                        {/if}
                        <span class="team-text">
                          <span class="team-name">{row.name}</span>
                          {#if row.tag}
                            <span class="team-tag">[{String(row.tag).toUpperCase()}]</span>
                          {/if}
                          <TeamSeed seed={seeds[row.id] ?? null} label="Playoff seed" />
                          {#if placed.locked && placed.zone}
                            <span class="zone-chip" title="Locked in — decided regardless of rank">
                              <Lock size={10} />
                              {placed.zone.label}
                            </span>
                          {/if}
                        </span>
                      </a>
                    </td>
                    {#if season?.showPoints}
                      <td class="col-num tabular col-points">{row.stats.points}</td>
                    {/if}
                    <td class="col-num tabular muted">{row.stats.series_played}</td>
                    <td class="col-num tabular">{row.stats.series_wins}</td>
                    <td class="col-num tabular">{row.stats.series_losses}</td>
                    <td class="col-num tabular muted">{row.stats.maps_played}</td>
                    <td class="col-num tabular">{row.stats.map_wins}</td>
                    <td class="col-num tabular">{row.stats.map_losses}</td>
                    <td
                      class="col-num tabular"
                      class:rd-pos={row.stats.round_diff > 0}
                      class:rd-neg={row.stats.round_diff < 0}
                    >
                      {row.stats.round_diff > 0 ? `+${row.stats.round_diff}` : row.stats.round_diff}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <div class="empty-state">
            <p class="empty-text">No standings yet.</p>
          </div>
        {/if}
      {/if}
    {/if}
  </div>
</PageContainer>

<style>
  /* Viewer's team */
  .my-team {
    display: flex;
    align-items: center;
    gap: 0.875rem;
    padding: 0.875rem 1.125rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(120, 67, 145, 0.35);
    background: rgba(120, 67, 145, 0.08);
    text-decoration: none;
    color: var(--text);
    margin-bottom: 0.75rem;
    transition: background 0.15s;
  }

  .my-team:hover {
    background: rgba(120, 67, 145, 0.14);
  }

  .my-team-logo {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 0.5rem;
    object-fit: contain;
    flex-shrink: 0;
  }

  .my-team-logo-blank,
  .team-logo-blank {
    background: rgba(255, 255, 255, 0.06);
  }

  .my-team-body {
    min-width: 0;
    flex: 1;
  }

  .my-team-label {
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent-text);
  }

  .my-team-name {
    font-size: 1rem;
    font-weight: 700;
    margin-top: 0.125rem;
  }

  .my-team-tag {
    font-size: 0.8125rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.5);
    margin-left: 0.375rem;
  }

  .my-team-role {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.64);
    text-transform: capitalize;
    margin-top: 0.125rem;
  }

  :global(.my-team-arrow) {
    color: rgba(255, 255, 255, 0.52);
    flex-shrink: 0;
  }

  /* Toolbar */
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
  }

  .search-wrap {
    position: relative;
    flex: 1;
    max-width: 20rem;
    min-width: 12rem;
  }

  .search-icon {
    position: absolute;
    top: 50%;
    left: 0.625rem;
    transform: translateY(-50%);
    color: rgba(255, 255, 255, 0.52);
    pointer-events: none;
    display: flex;
  }

  .search-input {
    width: 100%;
    padding: 0.5rem 0.75rem 0.5rem 2rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.2);
    color: var(--text);
    font-size: 0.8125rem;
  }

  .search-input::placeholder {
    color: rgba(255, 255, 255, 0.54);
  }

  .search-input:focus {
    outline: none;
    border-color: var(--hover);
  }

  /* Admin zone editor toggle */
  .zones-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.4375rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.55);
    cursor: pointer;
  }

  .zones-btn:hover {
    border-color: rgba(255, 255, 255, 0.16);
    color: rgba(255, 255, 255, 0.85);
  }

  /* Playoffs stage */
  .bracket-block {
    margin-bottom: 1.25rem;
    padding: 1rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.2);
  }

  .section-title {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.64);
    margin-bottom: 0.625rem;
  }

  /* The bracket's heading leads the page, so it reads louder than a section label. */
  .playoffs-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.125rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text);
    padding-bottom: 0.5rem;
    border-bottom: 2px solid var(--accent);
    margin-bottom: 0.875rem;
  }

  .playoffs-title :global(.playoffs-icon) {
    color: #facc15;
    flex-shrink: 0;
  }

  .table-compact .standings {
    font-size: 0.75rem;
  }

  .table-compact .standings td {
    padding-top: 0.3125rem;
    padding-bottom: 0.3125rem;
  }

  /* Zones */
  .zone-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem 1rem;
    margin-bottom: 0.5rem;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.78);
  }

  .zone-key {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
  }

  .zone-key-lock {
    color: rgba(255, 255, 255, 0.6);
  }

  .zone-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 9999px;
  }

  .zone-range {
    color: rgba(255, 255, 255, 0.5);
    font-variant-numeric: tabular-nums;
  }

  .standings td.zoned {
    box-shadow: inset 3px 0 0 var(--zone-color);
  }

  .standings tbody tr.zone-cut td {
    border-bottom: 1px dashed rgba(255, 255, 255, 0.28);
  }

  .zone-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.0625rem 0.375rem;
    border-radius: 9999px;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--zone-color);
    background: color-mix(in srgb, var(--zone-color) 14%, transparent);
    flex-shrink: 0;
    align-self: center;
  }

  /* Standings table */
  .table-wrap {
    overflow-x: auto;
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.2);
  }

  .standings {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
    min-width: 44rem;
  }

  .standings th {
    text-align: right;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: rgba(255, 255, 255, 0.6);
    padding: 0.75rem 0.625rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    white-space: nowrap;
  }

  .standings th.col-rank,
  .standings th.col-team {
    text-align: left;
  }

  .standings td {
    padding: 0.5rem 0.625rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.82);
  }

  .standings tbody tr:last-child td {
    border-bottom: none;
  }

  .standings tbody tr:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .row-mine {
    background: rgba(120, 67, 145, 0.08);
  }

  .col-rank {
    width: 3.25rem;
  }

  .col-team {
    min-width: 12rem;
  }

  .col-num {
    text-align: right;
    width: 3.75rem;
  }

  .col-points {
    font-weight: 700;
    color: var(--text);
  }

  .muted {
    color: rgba(255, 255, 255, 0.64);
  }

  .standings td.rd-pos {
    color: #4ade80;
  }

  .standings td.rd-neg {
    color: #f87171;
  }

  .rank-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.625rem;
    padding: 0.1875rem 0.375rem;
    border-radius: 0.3125rem;
    font-size: 0.75rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .team-cell {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    text-decoration: none;
    color: var(--text);
    min-width: 0;
  }

  .team-logo {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 0.25rem;
    object-fit: contain;
    flex-shrink: 0;
  }

  .team-text {
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 0.375rem;
  }

  .team-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .team-cell:hover .team-name {
    color: var(--accent-text);
  }

  .team-tag {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.62);
    flex-shrink: 0;
  }

  /* Empty */
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

  .empty-link {
    color: var(--accent-text);
    text-decoration: none;
  }

  .empty-link:hover {
    text-decoration: underline;
  }

  @media (max-width: 640px) {
    .toolbar {
      flex-direction: column;
      align-items: stretch;
    }

    .search-wrap {
      max-width: none;
    }
  }
</style>
