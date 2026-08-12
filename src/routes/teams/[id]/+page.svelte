<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import AdminEditLink from '$lib/components/AdminEditLink.svelte'
  import { Trophy, Users, CalendarDays, History } from 'lucide-svelte'
  import TeamSeed from '$lib/components/TeamSeed.svelte'
  import { resolve } from '$app/paths'

  let { data }: PageProps = $props()

  const team = $derived(data.team)
  const isAdmin = $derived(data.viewer?.isAdmin ?? false)
  const roster = $derived(data.roster ?? [])
  const upcomingMatches = $derived(data.upcomingMatches ?? [])
  const matchHistory = $derived(data.matchHistory ?? [])
  const leaderboard = $derived(data.leaderboard ?? null)
  const activeSeason = $derived(data.activeSeason ?? null)
  const seeds = $derived((data.seeds ?? {}) as Record<string, number>)

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
    riot_id_base?: string | null
    display_name?: string | null
    player_name?: string | null
    email?: string | null
  }) {
    return (
      player.riot_id_base ?? player.display_name ?? player.player_name ?? player.email ?? 'Player'
    )
  }

  /** Captains and IGLs lead the card list; everyone else keeps import order. */
  const sortedRoster = $derived(
    [...roster].sort((a, b) => {
      const rank = (role: string | null | undefined) =>
        role === 'captain' ? 0 : role === 'igl' ? 1 : 2
      return rank(a.role) - rank(b.role)
    })
  )

  const record = $derived(leaderboard ? `${leaderboard.wins}-${leaderboard.losses}` : null)

  /** Built as a list so absent facts don't leave a dangling separator. */
  const heroMeta = $derived.by(() => {
    const parts: string[] = []
    if (team.org) parts.push(String(team.org))
    if (leaderboard) parts.push(`Rank #${leaderboard.rank}`, `${record} series`)
    if (team.created_at) parts.push(`Formed ${new Date(team.created_at).toLocaleDateString()}`)
    return parts
  })
</script>

<svelte:head><title>{team.name}</title></svelte:head>

<PageContainer>
  <div class="team-page">
    <!-- Identity -->
    <section class="hero">
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
            <AdminEditLink href="/admin?tab=teams" label="Edit Team" class="hero-admin" />
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
    </section>

    <!-- Standings -->
    {#if leaderboard}
      <div class="stat-row">
        <div class="stat">
          <span class="stat-label">Rank</span>
          <span class="stat-value">#{leaderboard.rank}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Points</span>
          <span class="stat-value">{leaderboard.points}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Series</span>
          <span class="stat-value">{record}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Round Diff</span>
          <span
            class="stat-value"
            class:stat-pos={Number(leaderboard.round_diff) > 0}
            class:stat-neg={Number(leaderboard.round_diff) < 0}
          >
            {Number(leaderboard.round_diff) > 0 ? '+' : ''}{leaderboard.round_diff}
          </span>
        </div>
      </div>

      <p class="stat-note">
        {activeSeason?.name ?? 'No active season'}
        {#if leaderboard.batch?.display_name}
          <span class="meta-dot">·</span> {leaderboard.batch.display_name}
        {/if}
        {#if leaderboard.batch?.as_of_date}
          <span class="meta-dot">·</span> as of {leaderboard.batch.as_of_date}
        {/if}
      </p>
    {/if}

    <!-- Roster -->
    <section class="card">
      <header class="card-head">
        <Users size={15} />
        <h2 class="card-title">Roster</h2>
        {#if data.statsBatchName}
          <span class="card-source">{data.statsBatchName}</span>
        {/if}
        <span class="card-count">{roster.length}</span>
      </header>

      {#if roster.length === 0}
        <p class="card-empty">No active players on this roster.</p>
      {:else}
        <div class="roster">
          {#each sortedRoster as player, pi (player.profile_id ?? pi)}
            <svelte:element
              this={player.profile_id ? 'a' : 'div'}
              href={player.profile_id ? `/players/${player.profile_id}` : undefined}
              class="player"
              class:player-link={Boolean(player.profile_id)}
            >
              <div class="player-head">
                <span class="player-name">{playerName(player)}</span>
                {#if player.role && player.role !== 'player'}
                  <span class="player-role">{player.role}</span>
                {/if}
              </div>

              {#if player.stats}
                <div class="player-stats">
                  <span><b>{fmt(player.stats.acs, 0)}</b> ACS</span>
                  <span><b>{fmt(player.stats.kd, 2)}</b> K/D</span>
                  <span><b>{fmt(player.stats.adr, 0)}</b> ADR</span>
                </div>
              {:else}
                <div class="player-stats player-stats-empty">No stats</div>
              {/if}
            </svelte:element>
          {/each}
        </div>
      {/if}

      {#if !activeSeason}
        <p class="card-note">
          Player stats appear once an active season exists and its stats are imported.
        </p>
      {/if}
    </section>

    <!-- Upcoming -->
    <section class="card">
      <header class="card-head">
        <CalendarDays size={15} />
        <h2 class="card-title">Upcoming</h2>
        {#if upcomingMatches.length > 0}
          <span class="card-count">{upcomingMatches.length}</span>
        {/if}
      </header>

      {#if upcomingMatches.length === 0}
        <p class="card-empty">No matches scheduled.</p>
      {:else}
        <div class="match-rows">
          {#each upcomingMatches as match (match.id)}
            {@const opp = opponentFor(match, team.id)}
            <a href={resolve(`/matches/${match.id}`)} class="match-row">
              <span class="row-badge row-badge-vs">vs</span>

              <TeamSeed seed={opp?.id ? (seeds[opp.id] ?? null) : null} />

              {#if opp?.logo_url}
                <img src={opp.logo_url} alt="" class="row-logo" />
              {:else}
                <span class="row-logo row-logo-empty"></span>
              {/if}

              <span class="row-name">
                {opp?.name ?? 'TBD'}
                {#if opp?.tag}<span class="row-tag">[{opp.tag}]</span>{/if}
              </span>

              <span class="row-when">{formatLocal(match.scheduled_at)}</span>
            </a>
          {/each}
        </div>
      {/if}
    </section>

    <!-- History -->
    <section class="card">
      <header class="card-head">
        <History size={15} />
        <h2 class="card-title">Match History</h2>
        {#if matchHistory.length > 0}
          <span class="card-count">{matchHistory.length}</span>
        {/if}
      </header>

      {#if matchHistory.length === 0}
        <p class="card-empty">No completed matches yet.</p>
      {:else}
        <div class="match-rows">
          {#each matchHistory as match (match.id)}
            {@const opp = opponentFor(match, team.id)}
            {@const score = scoreFor(match, team.id)}
            {@const won = score.us > score.them}
            <a href={resolve(`/matches/${match.id}`)} class="match-row">
              <span class="row-badge" class:row-win={won} class:row-loss={!won}>
                {won ? 'W' : 'L'}
              </span>

              <TeamSeed seed={opp?.id ? (seeds[opp.id] ?? null) : null} />

              {#if opp?.logo_url}
                <img src={opp.logo_url} alt="" class="row-logo" />
              {:else}
                <span class="row-logo row-logo-empty"></span>
              {/if}

              <span class="row-name">
                {opp?.name ?? 'Unknown'}
                {#if opp?.tag}<span class="row-tag">[{opp.tag}]</span>{/if}
              </span>

              <span class="row-score">
                <b class:score-win={won}>{score.us}</b>
                <span class="score-sep">–</span>
                <b class:score-win={!won}>{score.them}</b>
              </span>

              <span class="row-when">{formatLocal(match.scheduled_at)}</span>
            </a>
          {/each}
        </div>
      {/if}
    </section>
  </div>
</PageContainer>

<style>
  .team-page {
    width: 100%;
    max-width: 72rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 3rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* Identity */
  .hero {
    display: flex;
    align-items: flex-start;
    gap: 1.25rem;
    padding: 1.5rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.09);
    background: linear-gradient(135deg, rgba(120, 67, 145, 0.14), rgba(0, 0, 0, 0.25));
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

  /* Standings tiles */
  .stat-row {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.625rem;
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.875rem 1rem;
    border-radius: 0.625rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.2);
  }

  .stat-label {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.55);
  }

  .stat-value {
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  .stat-pos {
    color: #4ade80;
  }

  .stat-neg {
    color: #f87171;
  }

  .stat-note {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    margin-top: -0.375rem;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
  }

  /* Cards */
  .card {
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.2);
    overflow: hidden;
  }

  .card-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    color: var(--accent-text);
  }

  .card-title {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--title);
  }

  /* Names the import the roster numbers came from. */
  .card-source {
    margin-left: auto;
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.45);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-source + .card-count {
    margin-left: 0;
  }

  .card-count {
    margin-left: auto;
    font-size: 0.6875rem;
    font-weight: 700;
    padding: 0.125rem 0.4375rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.6);
    font-variant-numeric: tabular-nums;
  }

  .card-empty {
    padding: 2rem 1rem;
    text-align: center;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .card-note {
    padding: 0 1rem 1rem;
    font-size: 0.75rem;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.5);
  }

  /* Roster — one row per player, stats trailing on the right. */
  .roster {
    display: flex;
    flex-direction: column;
  }

  .player {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.875rem;
    padding: 0.6875rem 1rem;
    text-decoration: none;
    color: var(--text);
    min-width: 0;
  }

  .player + .player {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .player-link {
    transition: background 0.15s;
  }

  .player-link:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .player-link:hover .player-name {
    color: var(--accent-text);
  }

  .player-head {
    display: flex;
    align-items: center;
    gap: 0.4375rem;
    min-width: 0;
  }

  .player-name {
    font-size: 0.875rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.15s;
  }

  .player-role {
    flex-shrink: 0;
    font-size: 0.5625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.125rem 0.3125rem;
    border-radius: 0.25rem;
    background: rgba(120, 67, 145, 0.28);
    color: #e9d5ff;
  }

  .player-stats {
    display: flex;
    flex-shrink: 0;
    gap: 0.75rem;
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.5);
    font-variant-numeric: tabular-nums;
  }

  .player-stats b {
    font-weight: 700;
    color: rgba(255, 255, 255, 0.82);
  }

  .player-stats-empty {
    font-style: italic;
    opacity: 0.75;
  }

  /* One row shape for both upcoming fixtures and completed results. */
  .match-rows {
    display: flex;
    flex-direction: column;
  }

  .match-row {
    display: flex;
    align-items: center;
    gap: 0.6875rem;
    padding: 0.6875rem 1rem;
    text-decoration: none;
    color: var(--text);
    transition: background 0.15s;
  }

  .match-row + .match-row {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .match-row:hover {
    background: rgba(255, 255, 255, 0.04);
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
    color: #4ade80;
  }

  .row-loss {
    background: rgba(248, 113, 113, 0.14);
    color: #f87171;
  }

  .row-badge-vs {
    font-size: 0.5625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.5);
  }

  .row-logo {
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 0.3125rem;
    object-fit: contain;
    flex-shrink: 0;
  }

  .row-logo-empty {
    background: rgba(255, 255, 255, 0.06);
  }

  .row-name {
    flex: 1;
    min-width: 0;
    font-size: 0.875rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.15s;
  }

  .row-tag {
    font-weight: 500;
    color: rgba(255, 255, 255, 0.45);
  }

  .row-score {
    display: flex;
    align-items: center;
    gap: 0.3125rem;
    flex-shrink: 0;
    font-size: 0.9375rem;
    font-variant-numeric: tabular-nums;
    color: rgba(255, 255, 255, 0.45);
  }

  .score-win {
    color: var(--text);
  }

  .score-sep {
    opacity: 0.4;
    font-size: 0.75rem;
  }

  .row-when {
    flex-shrink: 0;
    text-align: right;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
  }

  /* Responsive */
  @media (max-width: 900px) {
    .stat-row {
      grid-template-columns: repeat(2, minmax(0, 1fr));
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

    .stat-value {
      font-size: 1.25rem;
    }

    /* The date is the first thing to go when the row runs out of room. */
    .row-when {
      display: none;
    }
  }
</style>
