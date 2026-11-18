<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import AdminEditLink from '$lib/components/AdminEditLink.svelte'
  import { Users, ChevronRight } from 'lucide-svelte'
  import TeamSeed from '$lib/components/TeamSeed.svelte'
  import RankHistoryChart from '$lib/components/RankHistoryChart.svelte'
  import { resolve } from '$app/paths'
  import { formatLeftDay } from '$lib/players/roster-dates'
  import { invalidateAll } from '$app/navigation'

  let { data }: PageProps = $props()

  const team = $derived(data.team)
  const isAdmin = $derived(data.viewer?.isAdmin ?? false)
  const roster = $derived(data.roster ?? [])
  const formerPlayers = $derived(data.formerPlayers ?? [])
  const upcomingMatches = $derived(data.upcomingMatches ?? [])
  const matchHistory = $derived(data.matchHistory ?? [])
  const leaderboard = $derived(data.leaderboard ?? null)
  const activeSeason = $derived(data.activeSeason ?? null)
  const seeds = $derived((data.seeds ?? {}) as Record<string, number>)
  const rankHistory = $derived(data.rankHistory ?? [])

  let formerBusy = $state<string | null>(null)
  let formerError = $state<string | null>(null)

  /** Hide a duplicate or mis-entered departure from the list, or bring it back. */
  async function setFormerHidden(membershipIds: number[], hidden: boolean) {
    formerBusy = membershipIds.join(',')
    formerError = null
    try {
      const res = await fetch('/api/admin/former-players', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: team.id, membershipIds, hidden }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        formerError = body?.message ?? 'Failed to update former player'
        return
      }
      await invalidateAll()
    } finally {
      formerBusy = null
    }
  }

  const statsSources = $derived(data.statsSources ?? [])
  /** Label for where the roster numbers come from, e.g. "Season 4 · 4 events". */
  const statsSourceLabel = $derived.by(() => {
    if (statsSources.length === 0) return null
    if (statsSources.length === 1) return statsSources[0]
    const season = data.statsSeasonName
    const events = `${statsSources.length} events`
    return season ? `${season} · ${events}` : events
  })

  function formatLocal(value: string | null | undefined) {
    if (!value) return 'Date TBD'
    return new Date(value).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  type TeamRel = { id?: string; name?: string; tag?: string | null; logo_url?: string | null }

  function side(value: unknown): TeamRel | null {
    if (!value) return null
    return (Array.isArray(value) ? value[0] : value) as TeamRel
  }

  function opponentFor(
    match: { team_a_id?: string; team_b_id?: string; team_a?: unknown; team_b?: unknown } | null,
    teamId: string
  ) {
    return side(match?.team_a_id === teamId ? match?.team_b : match?.team_a)
  }

  function scoreFor(
    match: { team_a_id?: string; team_a_score?: unknown; team_b_score?: unknown } | null,
    teamId: string
  ) {
    const a = Number(match?.team_a_score ?? 0)
    const b = Number(match?.team_b_score ?? 0)
    return match?.team_a_id === teamId ? { us: a, them: b } : { us: b, them: a }
  }

  function fmt(value: unknown, digits = 1) {
    const num = Number(value)
    return Number.isFinite(num) ? num.toFixed(digits) : '—'
  }

  function playerName(player: {
    display_name?: string | null
    player_name?: string | null
    email?: string | null
  }) {
    return player.display_name ?? player.player_name ?? player.email ?? 'Player'
  }

  /** Captains and IGLs lead the list; everyone else keeps import order. */
  const sortedRoster = $derived(
    [...roster].sort((a, b) => {
      const rank = (role: string | null | undefined) =>
        role === 'captain' ? 0 : role === 'igl' ? 1 : 2
      return rank(a.role) - rank(b.role)
    })
  )

  const record = $derived(leaderboard ? `${leaderboard.wins}-${leaderboard.losses}` : null)

  /**
   * Built as a list so absent facts don't leave a dangling separator. Rank and
   * record are in the standings strip right below, so they aren't repeated.
   */
  const heroMeta = $derived.by(() => {
    const parts: string[] = []
    if (team.org) parts.push(String(team.org))
    if (team.created_at) {
      const formed = new Date(team.created_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
      parts.push(`Formed ${formed}`)
    }
    return parts
  })

  /** "Up 2 places since last week" — the two newest weekly points. */
  const rankTrend = $derived.by(() => {
    if (rankHistory.length < 2) return null
    // In the playoffs the headline is the place locked, not a weekly move.
    const latest = rankHistory[rankHistory.length - 1]
    if (latest.playoff) return latest.playoff.label
    const moved =
      rankHistory[rankHistory.length - 2].rank - rankHistory[rankHistory.length - 1].rank
    if (moved === 0) return 'No change since last week'
    const places = Math.abs(moved) === 1 ? 'place' : 'places'
    return `${moved > 0 ? 'Up' : 'Down'} ${Math.abs(moved)} ${places} since last week`
  })

  const wonCount = $derived(
    matchHistory.filter((m) => {
      const score = scoreFor(m, team.id)
      return score.us > score.them
    }).length
  )

  const matchesNote = $derived.by(() => {
    const parts: string[] = []
    if (upcomingMatches.length > 0) parts.push(`${upcomingMatches.length} upcoming`)
    if (matchHistory.length > 0) {
      parts.push(`${wonCount}-${matchHistory.length - wonCount} in last ${matchHistory.length}`)
    }
    return parts.join(' · ')
  })
</script>

<svelte:head><title>{team.name}</title></svelte:head>

<PageContainer>
  <div class="team-page">
    <article class="sheet">
      <!-- Identity -->
      <header class="hero">
        {#if team.logo_url}
          <img src={team.logo_url} alt="{team.name} logo" class="hero-logo" />
        {:else}
          <div class="hero-logo hero-logo-empty">
            <Users size={36} />
          </div>
        {/if}

        <div class="hero-body">
          <div class="hero-title-row">
            <h1 class="hero-name">
              {team.name}
              {#if team.tag}<span class="hero-tag">[{team.tag}]</span>{/if}
            </h1>
            <TeamSeed seed={data.seed ?? null} />
            {#if isAdmin}
              <AdminEditLink
                href="/admin?tab=teams&team={team.id}"
                label="Edit Team"
                class="hero-admin"
              />
            {/if}
          </div>

          {#if heroMeta.length > 0}
            <div class="hero-meta">
              {#each heroMeta as part, i (part)}
                {#if i > 0}<span class="meta-dot">·</span>{/if}
                <span>{part}</span>
              {/each}
            </div>
          {/if}

          {#if team.about}
            <p class="hero-about">{team.about}</p>
          {/if}
        </div>
      </header>

      <!-- Standings, docked to the hero -->
      {#if leaderboard}
        <div class="strip">
          <dl class="strip-cells">
            <div class="strip-cell">
              <dt>Rank</dt>
              <dd>#{leaderboard.rank}</dd>
            </div>
            <div class="strip-cell">
              <dt>Points</dt>
              <dd>{leaderboard.points}</dd>
            </div>
            <div class="strip-cell">
              <dt>Series</dt>
              <dd>{record}</dd>
            </div>
            <div class="strip-cell">
              <dt>Round Diff</dt>
              <dd
                class:stat-pos={Number(leaderboard.round_diff) > 0}
                class:stat-neg={Number(leaderboard.round_diff) < 0}
              >
                {Number(leaderboard.round_diff) > 0 ? '+' : ''}{leaderboard.round_diff}
              </dd>
            </div>
          </dl>
        </div>
      {/if}

      <div class="cols">
        <div class="col">
          <!-- Roster -->
          <section aria-labelledby="roster-title">
            <div class="sheet-head">
              <h2 class="sheet-title" id="roster-title">Roster</h2>
              {#if statsSourceLabel}
                <span class="sheet-note" title={statsSources.join(' · ')}>{statsSourceLabel}</span>
              {/if}
            </div>

            <div class="sheet-body">
              {#if roster.length === 0}
                <p class="empty">No active players on this roster.</p>
              {:else}
                <div class="roster-head" aria-hidden="true">
                  <span>Player</span>
                  <span class="num">ACS</span>
                  <span class="num">K/D</span>
                  <span class="num">ADR</span>
                </div>
                <ul class="roster">
                  {#each sortedRoster as player, pi (player.profile_id ?? pi)}
                    <li class="player">
                      <span class="player-head">
                        {#if player.profile_id}
                          <a href={resolve(`/players/${player.profile_id}`)} class="player-name">
                            {playerName(player)}
                          </a>
                        {:else}
                          <span class="player-name">{playerName(player)}</span>
                        {/if}
                        {#if player.role && player.role !== 'player'}
                          <span class="player-role">{player.role}</span>
                        {/if}
                      </span>
                      <span class="num" title="ACS"
                        >{player.stats ? fmt(player.stats.acs, 0) : '—'}</span
                      >
                      <span class="num" title="K/D"
                        >{player.stats ? fmt(player.stats.kd, 2) : '—'}</span
                      >
                      <span class="num" title="ADR"
                        >{player.stats ? fmt(player.stats.adr, 0) : '—'}</span
                      >
                    </li>
                  {/each}
                </ul>
              {/if}

              {#if formerPlayers.length > 0}
                <details class="former">
                  <summary>
                    <ChevronRight size={13} class="former-chev" />
                    Former players · {formerPlayers.length}
                  </summary>
                  <ul class="former-list">
                    {#each formerPlayers as player, fi (player.profile_id ?? `former-${fi}`)}
                      <li class="former-row" class:former-hidden={player.hidden}>
                        {#if player.profile_id}
                          <a href={resolve(`/players/${player.profile_id}`)} class="former-name">
                            {playerName(player)}
                          </a>
                        {:else}
                          <span class="former-name">{playerName(player)}</span>
                        {/if}
                        <span class="former-trail">
                          <span class="former-dates">
                            {player.hidden ? 'Hidden · ' : ''}Left {formatLeftDay(player.left_at)}
                          </span>
                          {#if isAdmin}
                            <button
                              type="button"
                              class="former-action"
                              disabled={formerBusy !== null}
                              title={player.hidden
                                ? 'Show this player in the list again'
                                : 'Hide from this list (duplicate or mis-entered name)'}
                              onclick={() => setFormerHidden(player.membership_ids, !player.hidden)}
                            >
                              {formerBusy === player.membership_ids.join(',')
                                ? '…'
                                : player.hidden
                                  ? 'Restore'
                                  : 'Hide'}
                            </button>
                          {/if}
                        </span>
                      </li>
                    {/each}
                  </ul>
                  {#if formerError}<p class="former-error">{formerError}</p>{/if}
                </details>
              {/if}

              {#if !activeSeason}
                <p class="empty-note">
                  Player stats appear once an active season exists and its stats are imported.
                </p>
              {/if}
            </div>
          </section>

          <!-- Rank by week -->
          {#if rankHistory.length >= 2}
            <section class="col-section" aria-labelledby="trend-title">
              <div class="sheet-head">
                <h2 class="sheet-title" id="trend-title">Rank by week</h2>
                {#if rankTrend}<span class="sheet-note">{rankTrend}</span>{/if}
              </div>
              <div class="sheet-body">
                <RankHistoryChart points={rankHistory} />
              </div>
            </section>
          {/if}
        </div>

        <!-- Matches: fixtures first, then results -->
        <section class="col" aria-labelledby="matches-title">
          <div class="sheet-head">
            <h2 class="sheet-title" id="matches-title">Matches</h2>
            {#if matchesNote}<span class="sheet-note">{matchesNote}</span>{/if}
          </div>

          <div class="sheet-body">
            <h3 class="group">Upcoming</h3>
            {#if upcomingMatches.length === 0}
              <p class="empty">No matches scheduled.</p>
            {:else}
              <div class="match-rows">
                {#each upcomingMatches as match (match.id)}
                  {@const opp = opponentFor(match, team.id)}
                  <a href={resolve(`/matches/${match.id}`)} class="match-row">
                    <span class="row-badge row-badge-vs">vs</span>
                    <span class="row-seed">
                      <TeamSeed seed={opp?.id ? (seeds[opp.id] ?? null) : null} />
                    </span>
                    {#if opp?.logo_url}
                      <img src={opp.logo_url} alt="" class="row-logo" />
                    {:else}
                      <span class="row-logo row-logo-empty"></span>
                    {/if}
                    <span class="row-main">
                      <span class="row-name">
                        {opp?.name ?? 'TBD'}
                        {#if opp?.tag}<span class="row-tag">[{opp.tag}]</span>{/if}
                      </span>
                      <span class="row-sub">{formatLocal(match.scheduled_at)}</span>
                    </span>
                    <span class="row-when">{formatLocal(match.scheduled_at)}</span>
                  </a>
                {/each}
              </div>
            {/if}

            <h3 class="group">Results</h3>
            {#if matchHistory.length === 0}
              <p class="empty">No completed matches yet.</p>
            {:else}
              <div class="match-rows">
                {#each matchHistory as match (match.id)}
                  {@const opp = opponentFor(match, team.id)}
                  {@const score = scoreFor(match, team.id)}
                  {@const won = score.us > score.them}
                  <a href={resolve(`/matches/${match.id}`)} class="match-row">
                    <span
                      class="row-badge"
                      class:row-win={won}
                      class:row-loss={!won}
                      aria-label={won ? 'Win' : 'Loss'}
                    >
                      {won ? 'W' : 'L'}
                    </span>
                    <span class="row-seed">
                      <TeamSeed seed={opp?.id ? (seeds[opp.id] ?? null) : null} />
                    </span>
                    {#if opp?.logo_url}
                      <img src={opp.logo_url} alt="" class="row-logo" />
                    {:else}
                      <span class="row-logo row-logo-empty"></span>
                    {/if}
                    <span class="row-main">
                      <span class="row-name">
                        {opp?.name ?? 'Unknown'}
                        {#if opp?.tag}<span class="row-tag">[{opp.tag}]</span>{/if}
                      </span>
                      <span class="row-sub">{formatLocal(match.scheduled_at)}</span>
                    </span>
                    <span class="row-score">
                      <b class="score-us">{score.us}</b>
                      <span class="score-sep">–</span>
                      <b>{score.them}</b>
                    </span>
                    <span class="row-when">{formatLocal(match.scheduled_at)}</span>
                  </a>
                {/each}
              </div>
            {/if}
          </div>
        </section>
      </div>
    </article>
  </div>
</PageContainer>

<style>
  .team-page {
    width: 100%;
    max-width: 72rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 3rem;
  }

  /* Identity — the top of the sheet, no card of its own. */
  .hero {
    display: flex;
    align-items: flex-start;
    gap: 1.25rem;
    padding: 1.5rem;
  }

  .hero-logo {
    width: 5.5rem;
    height: 5.5rem;
    border-radius: 0.625rem;
    object-fit: contain;
    flex-shrink: 0;
  }

  .hero-logo-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.5);
  }

  .hero-body {
    min-width: 0;
    flex: 1;
  }

  .hero-title-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.625rem;
  }

  .hero-name {
    font-size: 1.875rem;
    font-weight: 700;
    line-height: 1.15;
    color: var(--title);
    letter-spacing: -0.015em;
  }

  .hero-tag {
    font-weight: 600;
    color: var(--accent-text);
  }

  :global(.hero-admin) {
    margin-left: auto;
    flex-shrink: 0;
    border-radius: 0.375rem;
    padding: 0.375rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .hero-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.375rem;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.62);
  }

  .meta-dot {
    opacity: 0.45;
  }

  .hero-about {
    margin-top: 0.75rem;
    max-width: 60ch;
    font-size: 0.875rem;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.75);
  }

  /* Standings strip — one divided band under the hero. */
  .strip {
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .strip-cells {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin: 0;
  }

  .strip-cell {
    display: flex;
    flex-direction: column;
    gap: 0.3125rem;
    padding: 0.875rem 1.5rem;
  }

  .strip-cell + .strip-cell {
    border-left: 1px solid rgba(255, 255, 255, 0.08);
  }

  .strip-cell dt {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.55);
  }

  .strip-cell dd {
    margin: 0;
    font-size: 1.375rem;
    font-weight: 700;
    line-height: 1;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  .stat-pos {
    color: var(--good) !important;
  }

  .stat-neg {
    color: var(--bad) !important;
  }

  /* Body — roster left, matches right, a hairline between. */
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .col {
    min-width: 0;
  }

  .col + .col {
    border-left: 1px solid rgba(255, 255, 255, 0.08);
  }

  .col-section {
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .sheet-head {
    align-items: baseline;
  }

  .empty {
    padding: 0.625rem 0;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .empty-note {
    margin-top: 0.75rem;
    font-size: 0.75rem;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.5);
  }

  /* Roster — one row per player, numbers lined up under a column header. */
  .roster-head,
  .player {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 3.25rem 3.25rem 3.25rem;
    gap: 0.5rem;
    align-items: center;
  }

  .roster-head {
    padding: 0.375rem 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.5);
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .roster {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .player {
    min-height: 2.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.82);
  }

  .player-head {
    display: flex;
    align-items: center;
    gap: 0.4375rem;
    min-width: 0;
  }

  .player-name {
    font-weight: 600;
    color: rgba(255, 255, 255, 0.82);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.15s;
  }

  a.player-name:hover {
    color: var(--accent-text);
  }

  .player-role {
    flex-shrink: 0;
    font-size: 0.5625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.125rem 0.3125rem;
    border-radius: 0.25rem;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.7);
  }

  /* Players who left mid-event — a closed footer under the live roster. */
  .former {
    margin-top: 0.875rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .former summary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.25rem;
    cursor: pointer;
    list-style: none;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.55);
  }

  .former summary::-webkit-details-marker {
    display: none;
  }

  .former summary:hover {
    color: rgba(255, 255, 255, 0.8);
  }

  .former :global(.former-chev) {
    transition: transform 0.15s;
  }

  .former[open] :global(.former-chev) {
    transform: rotate(90deg);
  }

  .former-list {
    list-style: none;
    margin: 0;
    padding: 0 0 0.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .former-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 0.8125rem;
    min-width: 0;
  }

  .former-name {
    color: rgba(255, 255, 255, 0.7);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  a.former-name:hover {
    color: var(--accent-text);
  }

  .former-trail {
    display: inline-flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .former-hidden .former-name {
    text-decoration: line-through;
    opacity: 0.5;
  }

  .former-action {
    padding: 0.0625rem 0.375rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.25rem;
    background: transparent;
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.55);
    cursor: pointer;
  }

  .former-action:hover:not(:disabled) {
    color: var(--text);
    border-color: rgba(255, 255, 255, 0.3);
  }

  .former-action:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .former-error {
    margin: 0.375rem 0 0;
    font-size: 0.75rem;
    color: var(--bad-text);
  }

  .former-dates {
    flex-shrink: 0;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.45);
    font-variant-numeric: tabular-nums;
  }

  /* Matches — one row shape for fixtures and results. */
  .group {
    margin: 0.625rem 0 0.125rem;
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.5);
  }

  .group:first-child {
    margin-top: 0.25rem;
  }

  .match-rows {
    display: flex;
    flex-direction: column;
  }

  .match-row {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    min-height: 2.75rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    text-decoration: none;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.82);
    transition: background 0.15s;
  }

  .match-row:hover {
    background: var(--row-hover);
  }

  .match-row:hover .row-name {
    color: var(--accent-text);
  }

  .row-badge {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.375rem;
    height: 1.375rem;
    border-radius: 0.3125rem;
    font-size: 0.6875rem;
    font-weight: 800;
    flex-shrink: 0;
  }

  .row-win {
    background: rgba(74, 222, 128, 0.16);
    color: var(--good);
  }

  .row-loss {
    background: rgba(248, 113, 113, 0.14);
    color: var(--bad);
  }

  .row-badge-vs {
    font-size: 0.5625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.55);
  }

  /* Holds its width when a team has no seed, so logos line up. */
  .row-seed {
    display: inline-flex;
    justify-content: center;
    width: 1.0625rem;
    flex-shrink: 0;
  }

  .row-logo {
    width: 1.625rem;
    height: 1.625rem;
    border-radius: 0.3125rem;
    object-fit: contain;
    flex-shrink: 0;
  }

  .row-logo-empty {
    background: rgba(255, 255, 255, 0.06);
  }

  .row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .row-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.15s;
  }

  .row-tag {
    font-weight: 400;
    color: rgba(255, 255, 255, 0.45);
  }

  /* The date moves under the name on phones instead of being dropped. */
  .row-sub {
    display: none;
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .row-score {
    display: flex;
    align-items: center;
    gap: 0.3125rem;
    flex-shrink: 0;
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
    color: rgba(255, 255, 255, 0.45);
  }

  .row-score b {
    font-weight: 600;
  }

  .score-us {
    color: rgba(255, 255, 255, 0.92);
  }

  .score-sep {
    opacity: 0.4;
    font-size: 0.75rem;
  }

  .row-when {
    flex-shrink: 0;
    width: 7rem;
    text-align: right;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
    font-variant-numeric: tabular-nums;
  }

  /* Responsive */
  @media (max-width: 860px) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
    }

    .col + .col {
      border-left: 0;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
  }

  @media (max-width: 640px) {
    .team-page {
      padding: 1rem 0.75rem 2rem;
    }

    .hero {
      gap: 0.875rem;
      padding: 1rem;
    }

    .hero-logo {
      width: 3.5rem;
      height: 3.5rem;
    }

    .hero-name {
      font-size: 1.375rem;
    }

    :global(.hero-admin) {
      margin-left: 0;
    }

    .strip-cells {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .strip-cell {
      padding: 0.75rem 1rem;
    }

    .strip-cell:nth-child(3) {
      border-left: 0;
    }

    .strip-cell:nth-child(n + 3) {
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }

    .strip-cell dd {
      font-size: 1.125rem;
    }

    .row-when {
      display: none;
    }

    .row-sub {
      display: block;
    }
  }
</style>
