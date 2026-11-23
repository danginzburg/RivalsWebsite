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

<style src="./page.css"></style>
