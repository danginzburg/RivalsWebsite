<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import AdminEditLink from '$lib/components/AdminEditLink.svelte'
  import ArchiveBracket from '$lib/components/ArchiveBracket.svelte'
  import CommentThread from '$lib/components/CommentThread.svelte'
  import { Trophy, Crown, Medal, ArrowLeft } from 'lucide-svelte'
  import { resolve } from '$app/paths'

  let { data }: PageProps = $props()

  const season = $derived(data.season)
  const teams = $derived(data.teams ?? [])
  const matches = $derived(data.matches ?? [])
  const leaderboard = $derived(data.leaderboard ?? [])
  const bracket = $derived(data.bracket)
  const isAdmin = $derived(data.viewer?.isAdmin ?? false)

  type TabId = 'overview' | 'bracket' | 'standings' | 'matches' | 'teams'
  let activeTab = $state<TabId>('overview')

  const tabs = $derived.by(() => {
    const items: Array<{ id: TabId; label: string }> = [{ id: 'overview', label: 'Overview' }]
    if (bracket.slots.length > 0) items.push({ id: 'bracket', label: 'Bracket' })
    if (leaderboard.length > 0) items.push({ id: 'standings', label: 'Standings' })
    if (matches.length > 0) items.push({ id: 'matches', label: `Matches (${matches.length})` })
    if (teams.length > 0) items.push({ id: 'teams', label: `Teams (${teams.length})` })
    return items
  })

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

  function formatDate(value: string | null) {
    if (!value) return 'TBD'
    return new Date(value).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const completedCount = $derived(matches.filter((m: any) => m.status === 'completed').length)
</script>

<svelte:head><title>{season.name}</title></svelte:head>

<PageContainer>
  <div class="page-content py-6">
    <a href={resolve('/events')} class="back-link">
      <ArrowLeft size={14} />
      All events
    </a>

    <!-- Header -->
    <div class="season-header">
      {#if season.logo_url}
        <img src={season.logo_url} alt="{season.name} logo" class="season-logo" />
      {/if}
      <div class="season-header-main">
        <div class="title-row">
          <span class="season-code">{season.code}</span>
          <h1 class="season-name">{season.name}</h1>
          {#if season.is_active}
            <span class="badge badge-active">Active</span>
          {/if}
        </div>
        <p class="season-dates">{formatRange(season.starts_on, season.ends_on)}</p>
      </div>
      {#if isAdmin}
        <AdminEditLink href="/admin?tab=seasons" label="Manage Season" />
      {/if}
    </div>

    <!-- Podium -->
    {#if season.winner || season.runner_up || season.mvp}
      <div class="podium">
        {#if season.winner}
          <a href={resolve(`/teams/${season.winner.id}`)} class="podium-card podium-champion">
            <Trophy size={20} style="color: #fcd34d;" />
            <div class="podium-body">
              <div class="podium-label">Champion</div>
              <div class="podium-value">
                {#if season.winner.logo_url}
                  <img src={season.winner.logo_url} alt="" class="podium-logo" />
                {/if}
                {season.winner.name}
              </div>
            </div>
          </a>
        {/if}
        {#if season.runner_up}
          <a href={resolve(`/teams/${season.runner_up.id}`)} class="podium-card">
            <Medal size={20} style="color: rgba(255,255,255,0.5);" />
            <div class="podium-body">
              <div class="podium-label">Runner-up</div>
              <div class="podium-value">
                {#if season.runner_up.logo_url}
                  <img src={season.runner_up.logo_url} alt="" class="podium-logo" />
                {/if}
                {season.runner_up.name}
              </div>
            </div>
          </a>
        {/if}
        {#if season.mvp}
          <a href={resolve(`/players/${season.mvp.id}`)} class="podium-card podium-mvp">
            <Crown size={20} style="color: #c084fc;" />
            <div class="podium-body">
              <div class="podium-label">MVP</div>
              <div class="podium-value">{season.mvp.name}</div>
            </div>
          </a>
        {/if}
      </div>
    {/if}

    <!-- Tabs -->
    {#if tabs.length > 1}
      <div class="tab-bar">
        {#each tabs as tab (tab.id)}
          <button
            type="button"
            class="tab-item"
            class:tab-active={activeTab === tab.id}
            onclick={() => (activeTab = tab.id)}
          >
            {tab.label}
          </button>
        {/each}
      </div>
    {/if}

    <!-- Panels -->
    {#if activeTab === 'overview'}
      <!-- Overview is the whole season on one page; the other tabs are
           focused views of the same blocks. -->
      <div class="overview">
        <div class="panel">
          {#if season.summary}
            <p class="summary">{season.summary}</p>
          {/if}
          <div class="stat-grid">
            <div class="stat-cell">
              <div class="stat-num">{teams.length}</div>
              <div class="stat-label">Teams</div>
            </div>
            <div class="stat-cell">
              <div class="stat-num">{matches.length}</div>
              <div class="stat-label">Matches</div>
            </div>
            <div class="stat-cell">
              <div class="stat-num">{completedCount}</div>
              <div class="stat-label">Played</div>
            </div>
            <div class="stat-cell">
              <div class="stat-num">{bracket.teamCount > 0 ? bracket.teamCount : '—'}</div>
              <div class="stat-label">
                {bracket.teamCount === 1 ? 'Playoff team' : 'Playoff teams'}
              </div>
            </div>
          </div>
          {#if !season.summary && teams.length === 0 && matches.length === 0}
            <p class="empty-text">No data recorded for this season yet.</p>
          {/if}
        </div>

        {#if teams.length > 0}
          <section class="panel">
            <h2 class="block-title">Teams <span class="block-count">{teams.length}</span></h2>
            {@render teamsGrid()}
          </section>
        {/if}

        {#if leaderboard.length > 0}
          <section class="panel">
            <h2 class="block-title">
              Standings
              {#if data.leaderboardLabel}
                <span class="block-note">{data.leaderboardLabel}</span>
              {/if}
            </h2>
            {@render standingsTable()}
          </section>
        {/if}

        {#if bracket.slots.length > 0}
          <section class="panel">
            <h2 class="block-title">Playoff Bracket</h2>
            <ArchiveBracket slots={bracket.slots} teams={bracket.teams} />
          </section>
        {/if}

        {#if matches.length > 0}
          <section class="panel">
            <h2 class="block-title">
              Matches <span class="block-count">{matches.length}</span>
            </h2>
            <!-- Long seasons would run to thousands of pixels, so the list
                 scrolls within a fixed frame instead. -->
            <div class="match-scroll">
              {@render matchList()}
            </div>
          </section>
        {/if}
      </div>
    {:else if activeTab === 'bracket'}
      <div class="panel">
        <ArchiveBracket slots={bracket.slots} teams={bracket.teams} />
      </div>
    {:else if activeTab === 'standings'}
      <div class="panel">
        {#if data.leaderboardLabel}
          <p class="panel-note">{data.leaderboardLabel}</p>
        {/if}
        {@render standingsTable()}
      </div>
    {:else if activeTab === 'matches'}
      <div class="panel">
        {@render matchList()}
      </div>
    {:else if activeTab === 'teams'}
      <div class="panel">
        {@render teamsGrid()}
      </div>
    {/if}

    <CommentThread
      entityType="season"
      entityId={season.id}
      comments={data.comments ?? []}
      viewerId={data.viewer?.profileId ?? null}
      isAdmin={data.viewer?.isAdmin ?? false}
    />
  </div>
</PageContainer>

{#snippet teamsGrid()}
  <div class="team-grid">
    {#each teams as team (team.id)}
      <a href={resolve(`/teams/${team.id}`)} class="team-card">
        {#if team.logo_url}
          <img src={team.logo_url} alt="" class="team-card-logo" />
        {:else}
          <div class="team-card-logo team-card-logo-blank"></div>
        {/if}
        <div class="team-card-body">
          <div class="team-card-name">{team.name}</div>
          {#if team.tag}
            <div class="team-card-tag">[{team.tag}]</div>
          {/if}
        </div>
      </a>
    {/each}
  </div>
{/snippet}

{#snippet standingsTable()}
  <div class="table-scroll">
    <table class="data-table">
      <thead>
        <tr>
          <th class="col-rank">#</th>
          <th>Team</th>
          <th class="col-num">Pts</th>
          <th class="col-num">W</th>
          <th class="col-num">L</th>
        </tr>
      </thead>
      <tbody>
        {#each leaderboard as row, i (row.team?.id ?? i)}
          <tr>
            <td class="col-rank tabular">{row.rank || i + 1}</td>
            <td>
              {#if row.team}
                <a href={resolve(`/teams/${row.team.id}`)} class="team-cell">
                  {#if row.team.logo_url}
                    <img src={row.team.logo_url} alt="" class="cell-logo" />
                  {/if}
                  {row.team.name}
                </a>
              {:else}
                <span class="muted">Unknown team</span>
              {/if}
            </td>
            <td class="col-num tabular">{row.points}</td>
            <td class="col-num tabular">{row.wins}</td>
            <td class="col-num tabular">{row.losses}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/snippet}

{#snippet matchList()}
  <div class="match-list">
    {#each matches as match (match.id)}
      <a href={resolve(`/matches/${match.id}`)} class="match-row">
        <!-- Always rendered, even when empty, so the grid columns line up
             across rows whether or not a match has a designation. -->
        <span class="match-designation">
          {#if match.designation}<span class="designation-chip">{match.designation}</span>{/if}
        </span>
        <div class="match-body">
          <span
            class="match-team match-team-a"
            class:match-winner={match.winner_team_id === match.team_a?.id}
          >
            {match.team_a?.name ?? 'TBD'}
          </span>
          <span class="match-mid">
            {#if match.status === 'completed'}
              <span class="match-score tabular">
                {match.team_a_score}–{match.team_b_score}
              </span>
            {:else}
              <span class="match-vs">vs</span>
            {/if}
          </span>
          <span
            class="match-team match-team-b"
            class:match-winner={match.winner_team_id === match.team_b?.id}
          >
            {match.team_b?.name ?? 'TBD'}
          </span>
        </div>
        <span class="match-date">{formatDate(match.scheduled_at)}</span>
      </a>
    {/each}
  </div>
{/snippet}

<style>
  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.45);
    text-decoration: none;
    margin-bottom: 0.875rem;
    transition: color 0.15s;
  }

  .back-link:hover {
    color: var(--hover);
  }

  .season-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.25rem;
  }

  .season-logo {
    width: 3.5rem;
    height: 3.5rem;
    border-radius: 0.625rem;
    object-fit: contain;
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.04);
  }

  .season-header-main {
    flex: 1;
    min-width: 0;
  }

  .title-row {
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
    font-size: 1.625rem;
    font-weight: 700;
    color: var(--title);
    line-height: 1.2;
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
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.45);
    margin-top: 0.25rem;
  }

  /* Podium */
  .podium {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 0.625rem;
    margin-bottom: 1.25rem;
  }

  .podium-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    border-radius: 0.625rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.22);
    text-decoration: none;
    color: var(--text);
    transition:
      border-color 0.15s,
      background 0.15s;
  }

  .podium-card:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .podium-champion {
    border-color: rgba(252, 211, 77, 0.3);
    background: rgba(252, 211, 77, 0.06);
  }

  .podium-mvp {
    border-color: rgba(192, 132, 252, 0.28);
    background: rgba(192, 132, 252, 0.06);
  }

  .podium-body {
    min-width: 0;
  }

  .podium-label {
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.42);
  }

  .podium-value {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.9375rem;
    font-weight: 700;
    margin-top: 0.125rem;
  }

  .podium-logo {
    width: 1.125rem;
    height: 1.125rem;
    border-radius: 0.1875rem;
    object-fit: contain;
  }

  /* Tabs */
  .tab-bar {
    display: flex;
    gap: 0.25rem;
    background: rgba(0, 0, 0, 0.25);
    border-radius: 0.5rem;
    padding: 0.25rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
    margin-bottom: 1rem;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .tab-item {
    padding: 0.4375rem 0.875rem;
    border-radius: 0.375rem;
    font-size: 0.8125rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.55);
    background: transparent;
    border: none;
    cursor: pointer;
    white-space: nowrap;
    transition:
      color 0.15s,
      background 0.15s;
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
    background: var(--hover);
  }

  /* Panels */
  .panel {
    padding: 1.25rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.2);
  }

  .panel-note {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.45);
    margin-bottom: 0.75rem;
  }

  /* Overview stacks every block on one page. */
  .overview {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .block-title {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.45);
    margin-bottom: 0.875rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }

  .block-count {
    font-size: 0.625rem;
    font-weight: 700;
    padding: 0.0625rem 0.375rem;
    border-radius: 9999px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.6);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0;
  }

  .block-note {
    margin-left: auto;
    font-size: 0.625rem;
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    color: rgba(255, 255, 255, 0.35);
  }

  /* Keeps a long season's match list from dominating the page. */
  .match-scroll {
    max-height: 26rem;
    overflow-y: auto;
    padding-right: 0.25rem;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
    -webkit-overflow-scrolling: touch;
  }

  .match-scroll::-webkit-scrollbar {
    width: 6px;
  }

  .match-scroll::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
  }

  .match-scroll::-webkit-scrollbar-track {
    background: transparent;
  }

  .summary {
    font-size: 0.9375rem;
    line-height: 1.65;
    color: rgba(255, 255, 255, 0.75);
    max-width: 62ch;
    margin-bottom: 1.25rem;
  }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: 0.625rem;
  }

  .stat-cell {
    text-align: center;
    padding: 0.875rem 0.5rem;
    border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
  }

  .stat-num {
    font-size: 1.375rem;
    font-weight: 700;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  .stat-label {
    font-size: 0.625rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: rgba(255, 255, 255, 0.42);
    margin-top: 0.125rem;
  }

  .empty-text {
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.45);
    text-align: center;
    padding: 2rem 0;
  }

  /* Table */
  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }

  .data-table th {
    text-align: left;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: rgba(255, 255, 255, 0.42);
    padding: 0.5rem 0.625rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    white-space: nowrap;
  }

  .data-table td {
    padding: 0.5rem 0.625rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.8);
  }

  .col-rank {
    width: 3rem;
    text-align: center;
  }

  .col-num {
    text-align: right;
    width: 4rem;
  }

  th.col-num {
    text-align: right;
  }

  .team-cell {
    display: inline-flex;
    align-items: center;
    gap: 0.4375rem;
    color: var(--text);
    text-decoration: none;
    font-weight: 500;
  }

  .team-cell:hover {
    color: var(--hover);
  }

  .cell-logo {
    width: 1.125rem;
    height: 1.125rem;
    border-radius: 0.1875rem;
    object-fit: contain;
  }

  .muted {
    color: rgba(255, 255, 255, 0.35);
  }

  /* Match list */
  /**
   * The list owns the columns so every row shares them. The designation and
   * date columns size to their widest content, which keeps the score column
   * at one x-position across all rows without capping the label width.
   */
  .match-list {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr) max-content;
    gap: 0.375rem;
  }

  .match-row {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 0.875rem;
    border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.025);
    border: 1px solid rgba(255, 255, 255, 0.05);
    text-decoration: none;
    color: var(--text);
    transition:
      border-color 0.15s,
      background 0.15s;
  }

  .match-row:hover {
    border-color: rgba(120, 67, 145, 0.4);
    background: rgba(255, 255, 255, 0.045);
  }

  /* Grid cell — the chip inside only renders when there is a designation. */
  .match-designation {
    min-width: 0;
  }

  .designation-chip {
    display: inline-block;
    font-size: 0.5625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #fcd34d;
    background: rgba(252, 211, 77, 0.1);
    padding: 0.1875rem 0.375rem;
    border-radius: 0.25rem;
    white-space: nowrap;
  }

  /* Equal side columns with a fixed centre, so the score is always centred. */
  .match-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 3.25rem minmax(0, 1fr);
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    font-size: 0.8125rem;
  }

  .match-team {
    color: rgba(255, 255, 255, 0.7);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  /* Names hug the score so the centre reads as the pivot. */
  .match-team-a {
    text-align: right;
  }

  .match-team-b {
    text-align: left;
  }

  .match-mid {
    text-align: center;
  }

  .match-winner {
    color: #86efac;
    font-weight: 700;
  }

  /* Without subgrid the rows cannot share tracks, so fall back to fixed
     columns — alignment is preserved, long designations ellipsize. */
  @supports not (grid-template-columns: subgrid) {
    .match-list {
      display: flex;
      flex-direction: column;
    }

    .match-row {
      grid-template-columns: 8rem minmax(0, 1fr) 6rem;
    }

    .designation-chip {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }

  .match-score {
    font-weight: 700;
  }

  .match-vs {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.35);
  }

  .match-date {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.4);
    white-space: nowrap;
    text-align: right;
  }

  /* Team grid */
  .team-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 0.625rem;
  }

  .team-card {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.75rem;
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

  .team-card-logo-blank {
    background: rgba(255, 255, 255, 0.06);
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

  .team-card-tag {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.42);
  }

  @media (max-width: 640px) {
    .season-name {
      font-size: 1.25rem;
    }

    .panel {
      padding: 0.875rem;
    }

    /* Too narrow for a designation column — drop the label and stack the
       date under the match so the score stays centred. */
    .match-list {
      display: flex;
      flex-direction: column;
    }

    .match-row {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas:
        'body'
        'date';
      gap: 0.25rem;
    }

    .match-designation {
      display: none;
    }

    .match-body {
      grid-area: body;
    }

    .match-date {
      grid-area: date;
      text-align: center;
    }
  }
</style>
