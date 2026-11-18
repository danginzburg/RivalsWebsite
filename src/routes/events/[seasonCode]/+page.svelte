<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import ArchiveBracket from '$lib/components/ArchiveBracket.svelte'
  import CommentThread from '$lib/components/CommentThread.svelte'
  import TeamSeed from '$lib/components/TeamSeed.svelte'
  import { ArrowLeft } from 'lucide-svelte'
  import { resolve } from '$app/paths'

  let { data }: PageProps = $props()

  const season = $derived(data.season)
  const teams = $derived(data.teams ?? [])
  const matches = $derived(data.matches ?? [])
  const leaderboard = $derived(data.leaderboard ?? [])
  const bracket = $derived(data.bracket)
  const mapPool = $derived(season.map_pool ?? [])

  // Presentation profile: which sections show + outbound links. Defaults to
  // everything on, so rivals events are unaffected.
  const sections = $derived(data.profile.sections)
  const externalLinks = $derived(data.profile.links ?? [])

  type TabId = 'overview' | 'bracket' | 'standings' | 'matches' | 'teams' | 'maps'
  let activeTab = $state<TabId>('overview')

  const showBracket = $derived(sections.bracket && bracket.slots.length > 0)
  const showStandings = $derived(sections.standings && leaderboard.length > 0)
  const showMatches = $derived(sections.matches && matches.length > 0)
  const showTeams = $derived(sections.teams && teams.length > 0)
  const showMaps = $derived(sections.mapPool && mapPool.length > 0)

  const tabs = $derived.by(() => {
    const items: Array<{ id: TabId; label: string; count?: number }> = [
      { id: 'overview', label: 'Overview' },
    ]
    if (showBracket) items.push({ id: 'bracket', label: 'Bracket' })
    if (showStandings) items.push({ id: 'standings', label: 'Standings' })
    if (showMatches) items.push({ id: 'matches', label: 'Matches', count: matches.length })
    if (showTeams) items.push({ id: 'teams', label: 'Teams', count: teams.length })
    if (showMaps) items.push({ id: 'maps', label: 'Map Pool' })
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

  // Teams that folded mid-event stay listed but are set apart, and sink to the
  // end of the teams list so the active field reads first.
  const disbandedIds = $derived(
    new Set(teams.filter((t: any) => t.disbanded).map((t: any) => t.id))
  )
  const sortedTeams = $derived(
    [...teams].sort((a: any, b: any) => Number(a.disbanded) - Number(b.disbanded))
  )
  const isDisbanded = (id: string | null | undefined) => Boolean(id) && disbandedIds.has(id!)

  const completedCount = $derived(matches.filter((m: any) => m.status === 'completed').length)

  const hasPodium = $derived(
    Boolean(season.winner || season.runner_up || season.third_place || season.mvp)
  )
</script>

<svelte:head><title>{season.name}</title></svelte:head>

<PageContainer>
  <div class="page-content py-6">
    <div class="sheet">
      <!-- Header: identity, summary, counts, podium and the tab bar as one block. -->
      <header class="event-head">
        <a href={resolve('/events')} class="back-link">
          <ArrowLeft size={14} />
          All events
        </a>

        <div class="title-row">
          {#if season.logo_url}
            <img src={season.logo_url} alt="{season.name} logo" class="season-logo" />
          {/if}
          <div class="title-main">
            <h1 class="season-name">{season.name}</h1>
            <p class="season-dates">{formatRange(season.starts_on, season.ends_on)}</p>
          </div>
          {#if externalLinks.length > 0}
            <nav class="event-links" aria-label="Event links">
              {#each externalLinks as link (link.url)}
                <!-- Off-site links (rulebook / signup / FAQ) live elsewhere for
                     non-rivals events, so open in a new tab. -->
                <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
                <a href={link.url} class="event-link" target="_blank" rel="noopener noreferrer">
                  {link.label}
                </a>
              {/each}
            </nav>
          {/if}
        </div>

        {#if season.summary}
          <p class="summary">{season.summary}</p>
        {/if}

        {#if teams.length > 0 || matches.length > 0}
          <div class="counts">
            <span><b>{teams.length}</b> {teams.length === 1 ? 'team' : 'teams'}</span>
            <span><b>{matches.length}</b> {matches.length === 1 ? 'match' : 'matches'}</span>
            <span><b>{completedCount}</b> played</span>
            {#if bracket.teamCount > 0}
              <span>
                <b>{bracket.teamCount}</b>
                {bracket.teamCount === 1 ? 'playoff team' : 'playoff teams'}
              </span>
            {/if}
          </div>
        {/if}

        {#if hasPodium}
          <div class="podium">
            {#if season.winner}
              <a href={resolve(`/teams/${season.winner.id}`)} class="podium-cell">
                <div class="podium-label podium-gold">Champion</div>
                <div class="podium-value">
                  {#if season.winner.logo_url}
                    <img src={season.winner.logo_url} alt="" class="podium-logo" />
                  {/if}
                  <span class="podium-name">{season.winner.name}</span>
                </div>
              </a>
            {/if}
            {#if season.runner_up}
              <a href={resolve(`/teams/${season.runner_up.id}`)} class="podium-cell">
                <div class="podium-label podium-silver">Runner-up</div>
                <div class="podium-value">
                  {#if season.runner_up.logo_url}
                    <img src={season.runner_up.logo_url} alt="" class="podium-logo" />
                  {/if}
                  <span class="podium-name">{season.runner_up.name}</span>
                </div>
              </a>
            {/if}
            {#if season.third_place}
              <a href={resolve(`/teams/${season.third_place.id}`)} class="podium-cell">
                <div class="podium-label podium-bronze">3rd place</div>
                <div class="podium-value">
                  {#if season.third_place.logo_url}
                    <img src={season.third_place.logo_url} alt="" class="podium-logo" />
                  {/if}
                  <span class="podium-name">{season.third_place.name}</span>
                </div>
              </a>
            {/if}
            {#if season.mvp?.id}
              <a href={resolve(`/players/${season.mvp.id}`)} class="podium-cell">
                <div class="podium-label podium-mvp">MVP</div>
                <div class="podium-value"><span class="podium-name">{season.mvp.name}</span></div>
              </a>
            {:else if season.mvp}
              <div class="podium-cell">
                <div class="podium-label podium-mvp">MVP</div>
                <div class="podium-value"><span class="podium-name">{season.mvp.name}</span></div>
              </div>
            {/if}
          </div>
        {/if}

        {#if tabs.length > 1}
          <div class="tab-bar" role="tablist" aria-label="Event sections">
            {#each tabs as tab (tab.id)}
              <button
                type="button"
                role="tab"
                class="tab-item"
                class:tab-active={activeTab === tab.id}
                aria-selected={activeTab === tab.id}
                onclick={() => (activeTab = tab.id)}
              >
                {tab.label}
                {#if tab.count != null}<span class="tab-count">{tab.count}</span>{/if}
              </button>
            {/each}
          </div>
        {/if}
      </header>

      {#if activeTab === 'overview'}
        <!-- Overview is the whole season on one sheet; the other tabs are
             focused views of the same sections. -->
        {#if showMaps}
          <section class="sheet-section">
            <div class="sheet-head"><h2 class="sheet-title">Map Pool</h2></div>
            <div class="sheet-body">{@render mapStrip()}</div>
          </section>
        {/if}

        {#if showStandings || showTeams}
          <div class="ev-pair sheet-section" class:ev-pair-both={showStandings && showTeams}>
            {#if showStandings}
              <section class="ev-pair-cell">
                <div class="sheet-head">
                  <h2 class="sheet-title">Standings</h2>
                  {#if data.leaderboardLabel}
                    <span class="sheet-note head-note">{data.leaderboardLabel}</span>
                  {/if}
                </div>
                <div class="sheet-body">{@render standingsTable()}</div>
              </section>
            {/if}
            {#if showTeams}
              <section class="ev-pair-cell">
                <div class="sheet-head"><h2 class="sheet-title">Teams</h2></div>
                <div class="sheet-body">{@render teamsList()}</div>
              </section>
            {/if}
          </div>
        {/if}

        {#if showBracket}
          <section class="sheet-section">
            <div class="sheet-head"><h2 class="sheet-title">Playoff Bracket</h2></div>
            <div class="sheet-body">{@render bracketView()}</div>
          </section>
        {/if}

        {#if showMatches}
          <section class="sheet-section">
            <div class="sheet-head">
              <h2 class="sheet-title">Matches</h2>
              <span class="sheet-note head-note">Newest first</span>
            </div>
            <div class="sheet-body">
              <!-- Long seasons would run to thousands of pixels, so the list
                   scrolls within a fixed frame instead. -->
              <div class="match-frame match-scroll">{@render matchList()}</div>
            </div>
          </section>
        {/if}

        {#if !season.summary && teams.length === 0 && matches.length === 0}
          <section class="sheet-section">
            <p class="empty-text">No data recorded for this season yet.</p>
          </section>
        {/if}
      {:else if activeTab === 'bracket'}
        <section class="sheet-section">
          <div class="sheet-head"><h2 class="sheet-title">Playoff Bracket</h2></div>
          <div class="sheet-body">{@render bracketView()}</div>
        </section>
      {:else if activeTab === 'standings'}
        <section class="sheet-section">
          <div class="sheet-head">
            <h2 class="sheet-title">Standings</h2>
            {#if data.leaderboardLabel}
              <span class="sheet-note head-note">{data.leaderboardLabel}</span>
            {/if}
          </div>
          <div class="sheet-body">{@render standingsTable()}</div>
        </section>
      {:else if activeTab === 'matches'}
        <section class="sheet-section">
          <div class="sheet-head">
            <h2 class="sheet-title">Matches</h2>
            <span class="sheet-note head-note">Newest first</span>
          </div>
          <div class="sheet-body">
            <div class="match-frame">{@render matchList()}</div>
          </div>
        </section>
      {:else if activeTab === 'teams'}
        <section class="sheet-section">
          <div class="sheet-head"><h2 class="sheet-title">Teams</h2></div>
          <div class="sheet-body">{@render teamsList()}</div>
        </section>
      {:else if activeTab === 'maps'}
        <section class="sheet-section">
          <div class="sheet-head"><h2 class="sheet-title">Map Pool</h2></div>
          <div class="sheet-body">{@render mapStrip()}</div>
        </section>
      {/if}

      {#if sections.comments}
        <CommentThread
          entityType="season"
          entityId={season.id}
          comments={data.comments ?? []}
          viewerId={data.viewer?.profileId ?? null}
          isAdmin={data.viewer?.isAdmin ?? false}
          variant="flush"
        />
      {/if}
    </div>
  </div>
</PageContainer>

{#snippet bracketView()}
  <ArchiveBracket
    slots={bracket.slots}
    teams={bracket.teams}
    seeds={bracket.seeds}
    matchIds={bracket.matchIds}
    series={bracket.series}
  />
{/snippet}

{#snippet teamsList()}
  <div class="team-list">
    {#each sortedTeams as team (team.id)}
      <a
        href={resolve(`/teams/${team.id}`)}
        class="team-item"
        class:team-item-disbanded={team.disbanded}
      >
        {#if team.logo_url}
          <img src={team.logo_url} alt="" class="team-item-logo" />
        {:else}
          <div class="team-item-logo team-item-logo-blank"></div>
        {/if}
        <div class="team-item-body">
          <div class="team-item-name">{team.name}</div>
          <div class="team-item-meta">
            {#if team.tag}
              <span>[{team.tag}]</span>
            {/if}
            <TeamSeed seed={bracket.seeds?.[team.id] ?? null} />
            {#if team.disbanded}
              <span class="disbanded-chip">Disbanded</span>
            {/if}
          </div>
        </div>
      </a>
    {/each}
  </div>
{/snippet}

{#snippet mapStrip()}
  <div class="map-strip">
    {#each mapPool as map (map.name)}
      <div class="map-item">
        {#if map.image}
          <img src={map.image} alt="" class="map-thumb" loading="lazy" />
        {:else}
          <div class="map-thumb map-thumb-blank"></div>
        {/if}
        <span class="map-name">{map.name}</span>
      </div>
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
          <tr class:row-disbanded={isDisbanded(row.team?.id)}>
            <td class="col-rank tabular">{row.rank || i + 1}</td>
            <td>
              {#if row.team}
                <div class="team-cell-wrap">
                  <a href={resolve(`/teams/${row.team.id}`)} class="team-cell">
                    {#if row.team.logo_url}
                      <img src={row.team.logo_url} alt="" class="cell-logo" />
                    {/if}
                    <span class="team-cell-name">{row.team.name}</span>
                  </a>
                  <TeamSeed seed={bracket.seeds?.[row.team.id] ?? null} label="Playoff seed" />
                  {#if isDisbanded(row.team.id)}
                    <span class="disbanded-chip">Disbanded</span>
                  {/if}
                </div>
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
            class:match-team-disbanded={isDisbanded(match.team_a?.id)}
            title={isDisbanded(match.team_a?.id) ? 'Disbanded during this event' : undefined}
          >
            <span class="match-team-name">{match.team_a?.name ?? 'TBD'}</span>
            <TeamSeed seed={bracket.seeds?.[match.team_a?.id ?? ''] ?? null} />
          </span>
          <span class="match-mid">
            {#if match.status === 'completed'}
              <span class="match-score tabular">
                <span class:score-winner={match.winner_team_id === match.team_a?.id}
                  >{match.team_a_score}</span
                >–<span class:score-winner={match.winner_team_id === match.team_b?.id}
                  >{match.team_b_score}</span
                >
              </span>
            {:else}
              <span class="match-vs">vs</span>
            {/if}
          </span>
          <span
            class="match-team match-team-b"
            class:match-winner={match.winner_team_id === match.team_b?.id}
            class:match-team-disbanded={isDisbanded(match.team_b?.id)}
            title={isDisbanded(match.team_b?.id) ? 'Disbanded during this event' : undefined}
          >
            <TeamSeed seed={bracket.seeds?.[match.team_b?.id ?? ''] ?? null} />
            <span class="match-team-name">{match.team_b?.name ?? 'TBD'}</span>
          </span>
        </div>
        <span class="match-date">{formatDate(match.scheduled_at)}</span>
      </a>
    {/each}
  </div>
{/snippet}

<style>
  /* Header block: a faint lighter fill sets it apart from the sections below,
     with the tab bar docked on its bottom edge. */
  .event-head {
    padding: 1.125rem 1.5rem 0;
    background: rgba(255, 255, 255, 0.025);
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.64);
    text-decoration: none;
    transition: color 0.15s;
  }

  .back-link:hover {
    color: var(--accent-text);
  }

  .title-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 1rem;
    margin-top: 0.875rem;
  }

  .season-logo {
    width: 4rem;
    height: 4rem;
    border-radius: 0.625rem;
    object-fit: contain;
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.04);
  }

  .title-main {
    flex: 1 1 15rem;
    min-width: 0;
  }

  .season-name {
    font-size: 1.625rem;
    font-weight: 700;
    color: var(--title);
    line-height: 1.2;
  }

  .season-dates {
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.64);
    margin-top: 0.25rem;
  }

  .event-links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .event-link {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.375rem 0.75rem;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.86);
    text-decoration: none;
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
  }

  .event-link:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.24);
  }

  .summary {
    margin-top: 0.875rem;
    max-width: 76ch;
    font-size: 0.875rem;
    line-height: 1.55;
    color: rgba(255, 255, 255, 0.82);
  }

  /* Season counts as a quiet inline strip, not a panel of stat cells. */
  .counts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem 1rem;
    margin-top: 0.75rem;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.6);
  }

  .counts b {
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
    font-variant-numeric: tabular-nums;
  }

  /* Podium: one row of hairline-split cells inside the header. Colour lives
     only on the label — gold champion, silver runner-up, bronze 3rd, purple MVP. */
  .podium {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    margin: 1.5rem -1.5rem 0;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .podium-cell {
    display: block;
    min-width: 0;
    padding: 0.875rem 1.5rem;
    color: var(--text);
    text-decoration: none;
    transition: background 0.15s;
  }

  .podium-cell + .podium-cell {
    border-left: 1px solid rgba(255, 255, 255, 0.08);
  }

  a.podium-cell:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .podium-label {
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .podium-gold {
    color: var(--gold);
  }

  .podium-silver {
    color: #cbd5e1;
  }

  .podium-bronze {
    color: #f0a35e;
  }

  .podium-mvp {
    color: #c084fc;
  }

  .podium-value {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.3125rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
    min-width: 0;
  }

  .podium-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .podium-logo {
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 0.25rem;
    object-fit: contain;
    flex-shrink: 0;
  }

  /* Tabs: underline tabs on the header's bottom hairline. */
  .tab-bar {
    display: flex;
    gap: 0.25rem;
    /* Same breathing room as the podium when the header has no podium. */
    margin: 1.5rem -1.5rem 0;
    padding: 0 0.875rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }

  .podium + .tab-bar {
    margin-top: 0;
  }

  .tab-item {
    min-height: 2.75rem;
    padding: 0.75rem 0.625rem 0.6875rem;
    font-size: 0.8125rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.6);
    background: none;
    border: 0;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    white-space: nowrap;
    transition:
      color 0.15s,
      border-color 0.15s;
  }

  .tab-item:hover {
    color: rgba(255, 255, 255, 0.88);
  }

  .tab-active {
    color: var(--text);
    border-bottom-color: var(--accent-text);
  }

  .tab-count {
    margin-left: 0.25rem;
    color: rgba(255, 255, 255, 0.42);
    font-variant-numeric: tabular-nums;
  }

  .head-note {
    margin-left: auto;
  }

  /* Standings and Teams side by side on wide screens, hairline between. */
  .ev-pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .ev-pair-both {
    grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
  }

  .ev-pair-both > .ev-pair-cell + .ev-pair-cell {
    border-left: 1px solid rgba(255, 255, 255, 0.08);
  }

  .ev-pair-cell {
    min-width: 0;
  }

  @media (max-width: 860px) {
    .ev-pair-both {
      grid-template-columns: minmax(0, 1fr);
    }

    .ev-pair-both > .ev-pair-cell + .ev-pair-cell {
      border-left: 0;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
  }

  .empty-text {
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.64);
    text-align: center;
    padding: 2rem 0;
  }

  /* Map pool: a compact strip of list thumbnails, scrolling sideways when narrow. */
  .map-strip {
    display: flex;
    gap: 0.625rem;
    overflow-x: auto;
    padding-bottom: 0.125rem;
    -webkit-overflow-scrolling: touch;
  }

  .map-item {
    flex: 1 0 7.375rem;
    min-width: 7.375rem;
  }

  .map-thumb {
    display: block;
    width: 100%;
    height: 1.875rem;
    object-fit: cover;
    border-radius: 0.375rem;
    opacity: 0.9;
  }

  .map-thumb-blank {
    background: rgba(255, 255, 255, 0.05);
  }

  .map-name {
    display: block;
    margin-top: 0.375rem;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.82);
  }

  /* Standings table */
  .table-scroll {
    overflow-x: auto;
  }

  /* Fixed layout hands the team column whatever the number columns leave, so
     long names ellipsize instead of pushing the table wider than a phone. */
  .data-table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }

  .data-table td {
    overflow: hidden;
  }

  .data-table th {
    text-align: left;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.5);
    padding: 0 0.5rem 0.4375rem;
    white-space: nowrap;
  }

  .data-table td {
    height: 2rem;
    padding: 0 0.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.82);
  }

  .col-rank {
    width: 2.25rem;
  }

  td.col-rank {
    color: rgba(255, 255, 255, 0.5);
  }

  .col-num {
    text-align: right;
    width: 2.75rem;
  }

  th.col-num {
    text-align: right;
  }

  .team-cell-wrap {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .team-cell {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    color: rgba(255, 255, 255, 0.82);
    font-weight: 600;
    text-decoration: none;
  }

  .team-cell:hover {
    color: var(--accent-text);
  }

  .team-cell-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cell-logo {
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 0.25rem;
    object-fit: contain;
    flex-shrink: 0;
  }

  .muted {
    color: rgba(255, 255, 255, 0.56);
  }

  /* Disbanded teams: dimmed, with a muted red chip. Dimming the row rather
     than hiding it keeps their results on record. */
  .disbanded-chip {
    display: inline-block;
    font-size: 0.5625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--bad-text);
    background: rgba(248, 113, 113, 0.12);
    border: 1px solid rgba(248, 113, 113, 0.25);
    padding: 0.0625rem 0.3125rem;
    border-radius: 0.25rem;
    white-space: nowrap;
    vertical-align: middle;
  }

  .row-disbanded td {
    color: rgba(255, 255, 255, 0.45);
  }

  .row-disbanded .team-cell {
    color: rgba(255, 255, 255, 0.5);
    text-decoration: line-through;
    text-decoration-color: rgba(248, 113, 113, 0.5);
  }

  /* Teams: compact two-column list, no card boxes. */
  .team-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 13rem), 1fr));
    gap: 0.125rem 1.125rem;
  }

  .team-item {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    min-width: 0;
    padding: 0.375rem 0;
    text-decoration: none;
    color: var(--text);
  }

  .team-item:hover .team-item-name {
    color: var(--accent-text);
  }

  .team-item-logo {
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 0.375rem;
    object-fit: contain;
    flex-shrink: 0;
  }

  .team-item-logo-blank {
    background: rgba(255, 255, 255, 0.06);
  }

  .team-item-body {
    min-width: 0;
  }

  .team-item-name {
    font-size: 0.8125rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.82);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.15s;
  }

  .team-item-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.125rem;
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .team-item-disbanded .team-item-logo {
    filter: grayscale(1);
    opacity: 0.5;
  }

  .team-item-disbanded .team-item-name {
    color: rgba(255, 255, 255, 0.5);
    text-decoration: line-through;
    text-decoration-color: rgba(248, 113, 113, 0.5);
  }

  /* Match list: hairline-split rows inside one frame. */
  .match-frame {
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 0.625rem;
    overflow: hidden;
  }

  /* Keeps a long season's match list from dominating the page. */
  .match-scroll {
    max-height: 26.25rem;
    overflow-y: auto;
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

  /**
   * The list owns the columns so every row shares them. The designation and
   * date columns size to their widest content, which keeps the score column
   * at one x-position across all rows without capping the label width.
   */
  .match-list {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr) max-content;
  }

  .match-row {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: center;
    gap: 0.75rem;
    min-height: 2.375rem;
    padding: 0.375rem 0.875rem;
    text-decoration: none;
    color: var(--text);
    transition: background 0.15s;
  }

  .match-row + .match-row {
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .match-row:hover {
    background: var(--row-hover);
  }

  /* Grid cell — the chip inside only renders when there is a designation. */
  .match-designation {
    min-width: 0;
  }

  .designation-chip {
    display: inline-block;
    font-size: 0.625rem;
    font-weight: 600;
    /* Gold, matching the designation on the match page header. */
    color: var(--gold-text);
    background: var(--gold-soft);
    padding: 0.125rem 0.4375rem;
    border-radius: 0.3125rem;
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
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-width: 0;
    color: rgba(255, 255, 255, 0.6);
    white-space: nowrap;
  }

  .match-team-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Names hug the score so the centre reads as the pivot. */
  .match-team-a {
    justify-content: flex-end;
  }

  .match-mid {
    text-align: center;
  }

  .match-winner {
    color: var(--text);
    font-weight: 600;
  }

  .match-team-disbanded {
    text-decoration: line-through;
    text-decoration-color: rgba(248, 113, 113, 0.55);
    opacity: 0.6;
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
    color: rgba(255, 255, 255, 0.82);
  }

  .score-winner {
    color: var(--good);
    font-weight: 600;
  }

  .match-vs {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.56);
  }

  .match-date {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
    white-space: nowrap;
    text-align: right;
  }

  @media (max-width: 720px) {
    .podium {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-auto-flow: row;
    }

    .podium-cell:nth-child(odd) {
      border-left: 0;
    }

    .podium-cell:nth-child(n + 3) {
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
  }

  @media (max-width: 640px) {
    .event-head {
      padding: 1rem 0.875rem 0;
    }

    .podium,
    .tab-bar {
      margin-left: -0.875rem;
      margin-right: -0.875rem;
    }

    .podium-cell {
      padding: 0.75rem 0.875rem;
    }

    .season-name {
      font-size: 1.25rem;
    }

    .season-logo {
      width: 3rem;
      height: 3rem;
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
      gap: 0.125rem;
      padding: 0.5rem 0.625rem;
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
      font-size: 0.6875rem;
    }
  }
</style>
