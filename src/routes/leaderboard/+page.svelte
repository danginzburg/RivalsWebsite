<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import PageHeading from '$lib/components/PageHeading.svelte'
  import AdminEditLink from '$lib/components/AdminEditLink.svelte'
  import { Trophy, Search, ChevronRight } from 'lucide-svelte'
  import TeamSeed from '$lib/components/TeamSeed.svelte'
  import { resolve } from '$app/paths'

  let { data }: PageProps = $props()

  const rows = $derived(data.rows ?? [])
  const batch = $derived(data.batch ?? null)
  const myTeam = $derived(data.myTeam ?? null)
  const seeds = $derived((data.seeds ?? {}) as Record<string, number>)
  const isAdmin = $derived(data.viewer?.isAdmin ?? false)

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
  const unranked = $derived(filtered.filter((r) => r.stats == null))

  /** Medal colouring for the top three. */
  function rankStyle(rank: number) {
    if (rank === 1) return 'background: rgba(252,211,77,0.16); color: #fcd34d;'
    if (rank === 2) return 'background: rgba(203,213,225,0.16); color: #cbd5e1;'
    if (rank === 3) return 'background: rgba(217,119,6,0.18); color: #fbbf24;'
    return 'background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.55);'
  }

  function diffStyle(diff: number) {
    if (diff > 0) return 'color: #86efac;'
    if (diff < 0) return 'color: #fca5a5;'
    return 'color: rgba(255,255,255,0.5);'
  }
</script>

<svelte:head><title>Leaderboard</title></svelte:head>

<PageContainer>
  <div class="page-content py-6">
    <PageHeading
      title="Leaderboard"
      subtitle="Standings and every team in the league."
      icon={Trophy}
    >
      {#snippet actions()}
        {#if isAdmin}
          <AdminEditLink href="/admin?tab=teams" label="Manage Teams" />
        {/if}
      {/snippet}
    </PageHeading>

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
      {#if batch}
        <span class="batch-note">
          {batch.display_name}{#if batch.as_of_date}<span class="batch-date">
              · as of {batch.as_of_date}</span
            >{/if}
        </span>
      {/if}
    </div>

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
        <div class="table-wrap">
          <table class="standings">
            <thead>
              <tr>
                <th class="col-rank">#</th>
                <th class="col-team">Team</th>
                <th class="col-num">Pts</th>
                <th class="col-num">Series</th>
                <th class="col-num">W</th>
                <th class="col-num">L</th>
                <th class="col-num">Maps</th>
                <th class="col-num">MW</th>
                <th class="col-num">ML</th>
                <th class="col-num">Diff</th>
              </tr>
            </thead>
            <tbody>
              {#each ranked as row (row.id)}
                {@const isMine = myTeam?.id === row.id}
                <tr class:row-mine={isMine}>
                  <td class="col-rank">
                    <span class="rank-badge" style={rankStyle(row.stats.rank)}>
                      {row.stats.rank}
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
                      </span>
                    </a>
                  </td>
                  <td class="col-num tabular col-points">{row.stats.points}</td>
                  <td class="col-num tabular muted">{row.stats.series_played}</td>
                  <td class="col-num tabular">{row.stats.series_wins}</td>
                  <td class="col-num tabular">{row.stats.series_losses}</td>
                  <td class="col-num tabular muted">{row.stats.maps_played}</td>
                  <td class="col-num tabular">{row.stats.map_wins}</td>
                  <td class="col-num tabular">{row.stats.map_losses}</td>
                  <td class="col-num tabular" style={diffStyle(row.stats.round_diff)}>
                    {row.stats.round_diff > 0 ? '+' : ''}{row.stats.round_diff}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      <!-- Teams with no standings entry -->
      {#if unranked.length > 0}
        <section class="unranked">
          <h2 class="unranked-title">
            {ranked.length > 0 ? 'Not in current standings' : 'Teams'}
            <span class="unranked-count">{unranked.length}</span>
          </h2>
          <div class="team-grid">
            {#each unranked as row (row.id)}
              <a
                href={resolve(`/teams/${row.id}`)}
                class="team-card"
                class:row-mine={myTeam?.id === row.id}
              >
                {#if row.logo_url}
                  <img src={row.logo_url} alt="" class="team-card-logo" />
                {:else}
                  <div class="team-card-logo team-logo-blank"></div>
                {/if}
                <div class="team-card-body">
                  <div class="team-card-name">{row.name}</div>
                  <div class="team-card-meta">
                    {#if row.tag}
                      <span class="team-card-tag">[{String(row.tag).toUpperCase()}]</span>
                    {/if}
                    <TeamSeed seed={seeds[row.id] ?? null} label="Playoff seed" />
                  </div>
                </div>
              </a>
            {/each}
          </div>
        </section>
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

  .batch-note {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.62);
  }

  .batch-date {
    color: rgba(255, 255, 255, 0.52);
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

  /* Unranked teams */
  .unranked {
    margin-top: 0.75rem;
    padding: 1.25rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.2);
  }

  .unranked-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.64);
    margin-bottom: 0.875rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }

  .unranked-count {
    font-size: 0.625rem;
    font-weight: 700;
    padding: 0.0625rem 0.375rem;
    border-radius: 9999px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.6);
    letter-spacing: 0;
  }

  .team-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 0.5rem;
  }

  .team-card {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.625rem 0.75rem;
    border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.025);
    border: 1px solid rgba(255, 255, 255, 0.05);
    text-decoration: none;
    color: var(--text);
    transition:
      border-color 0.15s,
      background 0.15s;
  }

  .team-card:hover {
    border-color: rgba(120, 67, 145, 0.4);
    background: rgba(255, 255, 255, 0.045);
  }

  .team-card-logo {
    width: 2rem;
    height: 2rem;
    border-radius: 0.25rem;
    object-fit: contain;
    flex-shrink: 0;
  }

  .team-card-body {
    min-width: 0;
  }

  .team-card-name {
    font-size: 0.8125rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .team-card-meta {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.0625rem;
  }

  .team-card-tag {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.62);
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

  @media (max-width: 640px) {
    .toolbar {
      flex-direction: column;
      align-items: stretch;
    }

    .search-wrap {
      max-width: none;
    }

    .unranked {
      padding: 0.875rem;
    }
  }
</style>
