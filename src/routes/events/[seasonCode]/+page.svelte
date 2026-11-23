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
  // A season whose playoffs the bracket cannot draw shows its final places instead.
  const showPlacements = $derived(
    sections.bracket && !showBracket && (bracket.placements?.length ?? 0) > 0
  )
  const showStandings = $derived(sections.standings && leaderboard.length > 0)
  const showMatches = $derived(sections.matches && matches.length > 0)
  const showTeams = $derived(sections.teams && teams.length > 0)
  const showMaps = $derived(sections.mapPool && mapPool.length > 0)

  const tabs = $derived.by(() => {
    const items: Array<{ id: TabId; label: string; count?: number }> = [
      { id: 'overview', label: 'Overview' },
    ]
    if (showBracket) items.push({ id: 'bracket', label: 'Bracket' })
    if (showPlacements) items.push({ id: 'bracket', label: 'Playoffs' })
    if (showStandings) items.push({ id: 'standings', label: 'Standings' })
    if (showMatches) items.push({ id: 'matches', label: 'Matches', count: matches.length })
    if (showTeams) items.push({ id: 'teams', label: 'Teams', count: teams.length })
    if (showMaps) items.push({ id: 'maps', label: 'Map Pool' })
    return items
  })

  function placeLabel(n: number) {
    const tens = n % 100
    if (tens >= 11 && tens <= 13) return `${n}th`
    return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
  }

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
        {:else if showPlacements}
          <section class="sheet-section">
            <div class="sheet-head"><h2 class="sheet-title">Playoff Results</h2></div>
            <div class="sheet-body">{@render placementsTable()}</div>
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
          {#if showBracket}
            <div class="sheet-head"><h2 class="sheet-title">Playoff Bracket</h2></div>
            <div class="sheet-body">{@render bracketView()}</div>
          {:else}
            <div class="sheet-head"><h2 class="sheet-title">Playoff Results</h2></div>
            <div class="sheet-body">{@render placementsTable()}</div>
          {/if}
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

{#snippet placementsTable()}
  <div class="table-scroll">
    <table class="data-table">
      <thead>
        <tr>
          <th class="col-place">Place</th>
          <th>Team</th>
        </tr>
      </thead>
      <tbody>
        {#each bracket.placements as row, i (row.team?.id ?? i)}
          <tr>
            <td class="col-place tabular">
              {placeLabel(row.start)}{#if row.end !== row.start}–{placeLabel(row.end)}{/if}
            </td>
            <td>
              {#if row.team}
                <a href={resolve(`/teams/${row.team.id}`)} class="team-cell">
                  {#if row.team.logo_url}
                    <img src={row.team.logo_url} alt="" class="cell-logo" />
                  {/if}
                  <span class="team-cell-name">{row.team.name}</span>
                </a>
              {:else}
                <span class="muted">Unknown team</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
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

<style src="./page.css"></style>
