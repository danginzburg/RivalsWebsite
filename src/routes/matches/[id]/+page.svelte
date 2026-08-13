<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import AdminEditLink from '$lib/components/AdminEditLink.svelte'
  import CommentThread from '$lib/components/CommentThread.svelte'
  import TeamSeed from '$lib/components/TeamSeed.svelte'
  import { BarChart3, CalendarDays, RadioTower, Video, AlertTriangle } from 'lucide-svelte'
  import { SvelteMap } from 'svelte/reactivity'
  import { resolve } from '$app/paths'
  import miksIcon from '$lib/assets/agents/Miks_icon.webp'

  let { data }: PageProps = $props()

  const match = $derived(data.match)
  const isAdmin = $derived(data.viewer?.isAdmin ?? false)
  const hasRealStats = $derived(data.match?.has_real_stats ?? false)
  let activeStatsTab = $state<'total' | string>('total')

  function teamName(value: unknown) {
    if (!value) return 'Team'
    if (Array.isArray(value)) return (value[0] as { name?: string } | undefined)?.name ?? 'Team'
    return (value as { name?: string }).name ?? 'Team'
  }

  function teamLogo(value: unknown) {
    if (!value) return null
    if (Array.isArray(value))
      return (value[0] as { logo_url?: string } | undefined)?.logo_url ?? null
    return (value as { logo_url?: string }).logo_url ?? null
  }

  function teamId(value: unknown): string | null {
    if (!value) return null
    const team = (Array.isArray(value) ? value[0] : value) as { id?: string } | undefined
    return team?.id ?? null
  }

  /** Standings position for a team, from its season's leaderboard. */
  const seeds = $derived((data.seeds ?? {}) as Record<string, number>)

  function teamSeed(value: unknown): number | null {
    const id = teamId(value)
    return id ? (seeds[id] ?? null) : null
  }

  function formatLocal(value: string | null | undefined) {
    if (!value) return 'Date TBD'
    const date = new Date(value)
    return date.toLocaleString(undefined, { timeZoneName: 'short' })
  }

  function formatStatus(status: string | null | undefined) {
    if (!status) return 'Unknown'
    return status.charAt(0).toUpperCase() + status.slice(1)
  }

  const isComplete = $derived(match.status === 'completed')

  /**
   * Which side the series is credited to. A forfeit can hand the series to the
   * team that lost on map score, so the stored winner outranks the scoreline.
   */
  const winnerId = $derived(
    match.winner_team_id ??
      (isComplete && match.team_a_score !== match.team_b_score
        ? match.team_a_score > match.team_b_score
          ? match.team_a_id
          : match.team_b_id
        : null)
  )

  function playerLabel(row: { profile_name?: string | null; player_name?: string | null }) {
    return row.profile_name ?? row.player_name ?? 'Player'
  }

  function playerHref(row: { profile_id?: string | null; player_name?: string | null }) {
    if (row.profile_id) return resolve(`/players/${row.profile_id}`)
    return `${resolve('/players/unclaimed')}?name=${encodeURIComponent(row.player_name ?? '')}`
  }

  function fmt(value: unknown, digits = 0) {
    if (value === null || value === undefined) return 'N/A'
    const num = Number(value)
    return Number.isFinite(num) ? num.toFixed(digits) : 'N/A'
  }

  function pct(value: unknown) {
    return value != null ? `${fmt(value, 0)}%` : 'N/A'
  }

  function sortByKillsDesc<
    T extends {
      kills?: unknown
      acs?: unknown
      profile_name?: string | null
      player_name?: string | null
    },
  >(rows: T[]): T[] {
    return [...rows].sort((a, b) => {
      const ak = Number(a.kills ?? 0)
      const bk = Number(b.kills ?? 0)
      const killsA = Number.isFinite(ak) ? ak : 0
      const killsB = Number.isFinite(bk) ? bk : 0
      if (killsB !== killsA) return killsB - killsA

      const aAcs = Number(a.acs ?? 0)
      const bAcs = Number(b.acs ?? 0)
      const acsA = Number.isFinite(aAcs) ? aAcs : 0
      const acsB = Number.isFinite(bAcs) ? bAcs : 0
      if (acsB !== acsA) return acsB - acsA

      return playerLabel(a).localeCompare(playerLabel(b), undefined, { sensitivity: 'base' })
    })
  }

  const agentAssetModules = import.meta.glob('$lib/assets/agents/*_icon.webp', {
    eager: true,
    import: 'default',
  }) as Record<string, string>

  const agentIconMap = $derived.by(() => {
    const map = new SvelteMap<string, string>()
    const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '')

    for (const [path, url] of Object.entries(agentAssetModules)) {
      const filename = path.split('/').pop() ?? ''
      const base = filename.replace(/_icon\.webp$/i, '')
      map.set(normalize(base), url)
    }

    if (map.has('harbor')) map.set('harbour', map.get('harbor')!)
    map.set('miks', miksIcon)
    return map
  })

  function agentIconUrl(agentName: string): string | null {
    const key = String(agentName ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
    return agentIconMap.get(key) ?? null
  }

  function parseAgents(value: unknown): string[] {
    if (typeof value !== 'string') return []
    return Array.from(
      new Set(
        value
          .split(/\s+/)
          .map((token) => token.trim())
          .filter(Boolean)
      )
    )
  }

  const statsTabs = $derived([
    ...(match.maps ?? []).map((map) => ({
      key: map.id,
      label: map.map_label,
      subLabel: map.map_name ?? null,
      team_a_rounds: map.team_a_rounds,
      team_b_rounds: map.team_b_rounds,
      rows: map.stats ?? [],
      isTotal: false,
      forfeit:
        map.forfeit && typeof map.forfeit === 'object'
          ? (map.forfeit as {
              forfeiting_team_id?: string
              label?: string
              forfeiting_team_name?: string | null
            })
          : null,
      isVoided: map.is_voided ?? false,
    })),
    {
      key: 'total',
      label: 'Series Total',
      subLabel: null,
      team_a_rounds: null,
      team_b_rounds: null,
      rows: match.total_stats ?? [],
      isTotal: true,
      forfeit: null,
      isVoided: false,
    },
  ])

  $effect(() => {
    const keys = statsTabs.map((tab) => tab.key)
    if (!keys.includes(activeStatsTab)) {
      activeStatsTab = 'total'
    }
  })

  const activeStats = $derived(
    statsTabs.find((tab) => tab.key === activeStatsTab) ?? statsTabs.at(-1) ?? null
  )
  const teamAStats = $derived(
    sortByKillsDesc((activeStats?.rows ?? []).filter((row) => row.team_id === match.team_a_id))
  )
  const teamBStats = $derived(
    sortByKillsDesc((activeStats?.rows ?? []).filter((row) => row.team_id === match.team_b_id))
  )
</script>

<svelte:head><title>{teamName(match.team_a)} vs {teamName(match.team_b)}</title></svelte:head>

{#snippet teamSide(team: unknown, side: 'a' | 'b')}
  {@const id = teamId(team)}
  <!-- eslint-disable svelte/no-navigation-without-resolve -->
  <!-- Both branches are resolve() calls; the rule cannot see through the ternary -->
  <a
    href={id ? resolve(`/teams/${id}`) : resolve('/')}
    class="sb-team"
    class:sb-team-b={side === 'b'}
    class:sb-loser={winnerId != null && id !== winnerId}
  >
    {#if teamLogo(team)}
      <img src={teamLogo(team)} alt="{teamName(team)} logo" class="sb-logo" />
    {:else}
      <span class="sb-logo sb-logo-empty"></span>
    {/if}
    <span class="sb-name-block">
      <span class="sb-name">{teamName(team)}</span>
      <TeamSeed seed={teamSeed(team)} label="Leaderboard rank" />
    </span>
  </a>
  <!-- eslint-enable svelte/no-navigation-without-resolve -->
{/snippet}

{#snippet statTable(label: string, rows: typeof teamAStats)}
  <div class="stat-block">
    <div class="stat-block-head">{label}</div>
    <div class="table-scroll">
      <table class="stat-table">
        <thead>
          <tr>
            <th class="col-player">Player</th>
            <th class="col-agent">Agent</th>
            <th>ACS</th>
            <th>K</th>
            <th>D</th>
            <th>A</th>
            <th>KD</th>
            <th>ADR</th>
            <th>KAST</th>
            <th>HS%</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row, i (row.profile_id ?? `anon-${label}-${i}`)}
            <tr>
              <td class="col-player">
                <!-- eslint-disable svelte/no-navigation-without-resolve -->
                <!-- playerHref() returns a resolve()-built URL (may include a query string) -->
                <a href={playerHref(row)} class="player-link">{playerLabel(row)}</a>
                <!-- eslint-enable svelte/no-navigation-without-resolve -->
              </td>
              <td class="col-agent">
                <span class="agents">
                  {#each parseAgents(row.agents) as agent (agent)}
                    {#if agentIconUrl(agent)}
                      <img src={agentIconUrl(agent)} alt={agent} title={agent} class="agent-icon" />
                    {:else}
                      <span class="agent-text">{agent}</span>
                    {/if}
                  {/each}
                </span>
              </td>
              <td class="num num-strong">{fmt(row.acs, 0)}</td>
              <td class="num">{fmt(row.kills, 0)}</td>
              <td class="num">{fmt(row.deaths, 0)}</td>
              <td class="num">{fmt(row.assists, 0)}</td>
              <td class="num">{fmt(row.kd, 2)}</td>
              <td class="num">{fmt(row.adr, 0)}</td>
              <td class="num">{pct(row.kast_pct)}</td>
              <td class="num">{pct(row.hs_pct)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
{/snippet}

<PageContainer>
  <div class="match-page">
    <!-- Scoreboard -->
    <section class="scoreboard">
      <div class="sb-top">
        {#if match.designation}
          <span class="sb-designation">{match.designation}</span>
        {/if}
        <span class="sb-status" class:sb-status-live={match.status === 'live'}>
          {formatStatus(match.status)}
        </span>
        {#if isAdmin}
          <AdminEditLink href="/admin?tab=matches" label="Edit Match" class="sb-admin" />
        {/if}
      </div>

      <div class="sb-row">
        {@render teamSide(match.team_a, 'a')}

        <div class="sb-center">
          {#if isComplete}
            <div class="sb-score">
              <span class="sb-num" class:sb-num-win={match.team_a_id === winnerId}>
                {match.team_a_score}
              </span>
              <span class="sb-dash">–</span>
              <span class="sb-num" class:sb-num-win={match.team_b_id === winnerId}>
                {match.team_b_score}
              </span>
            </div>
          {:else}
            <div class="sb-vs">vs</div>
          {/if}
          <div class="sb-format">BO{match.best_of}</div>
        </div>

        {@render teamSide(match.team_b, 'b')}
      </div>

      <div class="sb-when">{formatLocal(match.scheduled_at)}</div>
    </section>

    <!-- Forfeit ruling -->
    {#if match.forfeit_display}
      <div class="notice">
        <AlertTriangle size={17} />
        <div>
          {#if match.forfeit_display.kind === 'admin_award'}
            <p class="notice-title">Series result (forfeit)</p>
            <p class="notice-body">
              Official winner: <b>{match.forfeit_display.winnerTeamName ?? '—'}</b>. Map scores ({match.team_a_score}-{match.team_b_score})
              reflect play on the server.
              {#if match.forfeit_display.forfeitingTeamName}
                Forfeiting side: {match.forfeit_display.forfeitingTeamName}.
              {/if}
            </p>
            {#if match.forfeit_display.reason}
              <p class="notice-sub">{match.forfeit_display.reason}</p>
            {/if}
          {:else if match.forfeit_display.kind === 'no_show'}
            <p class="notice-title">No-show forfeit</p>
            <p class="notice-body">
              Winner: <b>{match.forfeit_display.winnerTeamName ?? '—'}</b>.
              {#if match.forfeit_display.forfeitingTeamName}
                Opponent did not field a team in time: {match.forfeit_display.forfeitingTeamName}.
              {/if}
            </p>
          {/if}
        </div>
      </div>
    {/if}

    <!--
      Details and Watch share one card: both answer "what is this match and
      how do I follow it", and as separate cards the short detail list left a
      ragged gap beside the stream list.
    -->
    <section class="card">
      <header class="card-head">
        <CalendarDays size={15} />
        <h2 class="card-title">Details</h2>
      </header>

      <div class="info-split">
        <div class="card-body">
          <dl class="detail-list">
            <div class="detail">
              <dt>Scheduled</dt>
              <dd>{formatLocal(match.scheduled_at)}</dd>
            </div>
            {#if match.started_at}
              <div class="detail">
                <dt>Started</dt>
                <dd>{formatLocal(match.started_at)}</dd>
              </div>
            {/if}
          </dl>

          {#if (match.metadata?.map_vetoes?.length ?? 0) > 0}
            <div class="veto">
              <div class="veto-label">Map Veto</div>
              <ol class="veto-list">
                {#each match.metadata.map_vetoes as veto, index (index)}
                  <li><span class="veto-num">{index + 1}</span>{veto}</li>
                {/each}
              </ol>
            </div>
          {/if}
        </div>

        <div class="watch">
          <div class="watch-head">
            <RadioTower size={13} />
            <span class="watch-label">Watch</span>
          </div>

          {#if (match.streams ?? []).length === 0 && !match.vod_url}
            <p class="watch-empty">No streams or VODs listed.</p>
          {:else}
            <div class="watch-list">
              {#each match.streams ?? [] as stream (stream.stream_url)}
                <!-- eslint-disable svelte/no-navigation-without-resolve -->
                <!-- stream_url is an external URL; resolve() only accepts internal paths -->
                <a
                  href={stream.stream_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="watch-item"
                >
                  <RadioTower size={15} class="watch-icon" />
                  <span class="watch-body">
                    <span class="watch-name">
                      {stream.metadata?.display_name || stream.platform}
                      {#if stream.is_primary}<span class="watch-pill">Primary</span>{/if}
                    </span>
                    <span class="watch-url">{stream.stream_url}</span>
                  </span>
                  <span class="watch-status">{stream.status}</span>
                </a>
                <!-- eslint-enable svelte/no-navigation-without-resolve -->
              {/each}

              {#if match.vod_url}
                <!-- eslint-disable svelte/no-navigation-without-resolve -->
                <!-- vod_url is an external URL; resolve() only accepts internal paths -->
                <a
                  href={match.vod_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="watch-item"
                >
                  <Video size={15} class="watch-icon" />
                  <span class="watch-body">
                    <span class="watch-name">YouTube VOD</span>
                    <span class="watch-url">{match.vod_url}</span>
                  </span>
                </a>
                <!-- eslint-enable svelte/no-navigation-without-resolve -->
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </section>

    <!-- Stats -->
    <section class="card">
      <header class="card-head">
        <BarChart3 size={15} />
        <h2 class="card-title">{hasRealStats ? 'Match Stats' : 'Expected Lineup'}</h2>
        {#if !hasRealStats && (match.total_stats?.length ?? 0) > 0}
          <span class="pre-match">Pre-match</span>
        {/if}
      </header>

      {#if statsTabs.length <= 1 && (match.total_stats?.length ?? 0) === 0}
        <p class="card-empty">
          No starters designated yet. Set starters in the admin panel to show the expected lineup.
        </p>
      {:else}
        <div class="card-body">
          {#if statsTabs.length > 1}
            <div class="map-tabs">
              {#each statsTabs as tab (tab.key)}
                <button
                  type="button"
                  class="map-tab"
                  class:map-tab-active={activeStatsTab === tab.key}
                  class:map-tab-void={tab.isVoided}
                  onclick={() => (activeStatsTab = String(tab.key))}
                >
                  <span class="map-tab-label">{tab.label}</span>
                  {#if tab.subLabel}<span class="map-tab-sub">{tab.subLabel}</span>{/if}
                  {#if tab.isVoided}<span class="map-tab-ff">FF</span>{/if}
                </button>
              {/each}
            </div>
          {/if}

          {#if activeStats}
            {#if !activeStats.isTotal}
              {#if activeStats.forfeit?.forfeiting_team_id}
                <div class="notice notice-sm">
                  <AlertTriangle size={15} />
                  <div>
                    <p class="notice-title">Forfeit note (this map)</p>
                    {#if activeStats.forfeit.forfeiting_team_name}
                      <p class="notice-body">
                        {activeStats.forfeit.forfeiting_team_name} forfeited this map in the context of
                        the series ruling.
                      </p>
                    {/if}
                    {#if activeStats.forfeit.label}
                      <p class="notice-sub">{activeStats.forfeit.label}</p>
                    {/if}
                  </div>
                </div>
              {/if}

              <div class="map-score" class:map-score-void={activeStats.isVoided}>
                {#if activeStats.isVoided}
                  <span class="void-pill">Voided / FF</span>
                {/if}
                <span>{teamName(match.team_a)}</span>
                <b>{activeStats.team_a_rounds}–{activeStats.team_b_rounds}</b>
                <span>{teamName(match.team_b)}</span>
              </div>
            {:else if (match.maps ?? []).length > 0}
              <div class="map-summary">
                {#each match.maps as map (map.id)}
                  <div class="map-chip" class:map-chip-void={map.is_voided}>
                    <div class="map-chip-head">
                      {map.map_label}
                      {#if map.is_voided}<span class="map-tab-ff">FF</span>{/if}
                    </div>
                    <div class="map-chip-name">{map.map_name ?? 'Map'}</div>
                    <div class="map-chip-score">
                      {map.team_a_rounds}–{map.team_b_rounds}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}

            <div class="stat-grid">
              {@render statTable(teamName(match.team_a), teamAStats)}
              {@render statTable(teamName(match.team_b), teamBStats)}
            </div>
          {/if}
        </div>
      {/if}
    </section>

    <CommentThread
      entityType="match"
      entityId={match.id}
      comments={data.comments ?? []}
      viewerId={data.viewer?.profileId ?? null}
      isAdmin={data.viewer?.isAdmin ?? false}
    />
  </div>
</PageContainer>

<style>
  .match-page {
    width: 100%;
    max-width: 90rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 3rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* Scoreboard */
  .scoreboard {
    position: relative;
    padding: 1.25rem 1.5rem 1rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.09);
    background: linear-gradient(135deg, rgba(120, 67, 145, 0.14), rgba(0, 0, 0, 0.25));
  }

  .sb-top {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    margin-bottom: 1rem;
  }

  .sb-designation {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #fcd34d;
  }

  .sb-status {
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.1875rem 0.5rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.09);
    color: rgba(255, 255, 255, 0.7);
  }

  .sb-status-live {
    background: rgba(74, 222, 128, 0.16);
    color: #4ade80;
  }

  :global(.sb-admin) {
    margin-left: auto;
    border-radius: 0.375rem;
    padding: 0.3125rem 0.6875rem;
    font-size: 0.6875rem;
    font-weight: 600;
  }

  .sb-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 1rem;
  }

  .sb-team {
    display: flex;
    align-items: center;
    gap: 0.875rem;
    min-width: 0;
    text-decoration: none;
    color: var(--text);
    transition: opacity 0.15s;
  }

  .sb-team-b {
    flex-direction: row-reverse;
    text-align: right;
  }

  /* The losing side recedes so the result reads at a glance. */
  .sb-loser {
    opacity: 0.55;
  }

  .sb-team:hover {
    opacity: 1;
  }

  .sb-team:hover .sb-name {
    color: var(--accent-text);
  }

  .sb-logo {
    width: 4rem;
    height: 4rem;
    border-radius: 0.5rem;
    object-fit: contain;
    flex-shrink: 0;
  }

  .sb-logo-empty {
    background: rgba(255, 255, 255, 0.06);
  }

  /*
   * Rank sits beside the name, not under it. Stacked, only the side that has
   * a rank grew a second line, so the two team blocks came out different
   * heights and the scoreboard looked lopsided.
   */
  .sb-name-block {
    display: flex;
    align-items: center;
    gap: 0.4375rem;
    min-width: 0;
  }

  /* Mirror the order on the right-hand side so the rank hugs the logo. */
  .sb-team-b .sb-name-block {
    flex-direction: row-reverse;
  }

  .sb-name {
    font-size: 1.25rem;
    font-weight: 700;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color 0.15s;
  }

  .sb-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .sb-score {
    display: flex;
    align-items: baseline;
    gap: 0.625rem;
  }

  .sb-num {
    font-size: 2.5rem;
    font-weight: 800;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: rgba(255, 255, 255, 0.4);
  }

  .sb-num-win {
    color: var(--text);
  }

  .sb-dash {
    font-size: 1.25rem;
    color: rgba(255, 255, 255, 0.3);
  }

  .sb-vs {
    font-size: 1.125rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.45);
  }

  .sb-format {
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.5);
  }

  .sb-when {
    margin-top: 0.875rem;
    text-align: center;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
  }

  /* Notices */
  .notice {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    border-radius: 0.625rem;
    border: 1px solid rgba(251, 191, 36, 0.3);
    background: rgba(251, 191, 36, 0.07);
    color: #fcd34d;
  }

  .notice-sm {
    margin-bottom: 0.875rem;
    padding: 0.625rem 0.875rem;
  }

  .notice-title {
    font-size: 0.8125rem;
    font-weight: 700;
    color: #fcd34d;
  }

  .notice-body {
    margin-top: 0.1875rem;
    font-size: 0.8125rem;
    line-height: 1.55;
    color: rgba(255, 255, 255, 0.8);
  }

  .notice-body b {
    font-weight: 700;
    color: var(--text);
  }

  .notice-sub {
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.6);
  }

  /* Cards */
  /*
   * Two panes inside one card. A rule rather than a gap, so they read as one
   * card split in two instead of two cards that lost their borders.
   */
  .info-split {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
  }

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

  .card-body {
    padding: 1rem;
  }

  .card-empty {
    padding: 2rem 1rem;
    text-align: center;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .pre-match {
    margin-left: auto;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.1875rem 0.5rem;
    border-radius: 999px;
    background: rgba(250, 204, 21, 0.16);
    color: #fcd34d;
  }

  /* Details */
  .detail-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .detail {
    display: flex;
    align-items: baseline;
    gap: 0.625rem;
    font-size: 0.8125rem;
  }

  .detail dt {
    width: 5rem;
    flex-shrink: 0;
    color: rgba(255, 255, 255, 0.5);
  }

  .detail dd {
    color: var(--text);
  }

  .veto {
    margin-top: 1rem;
    padding-top: 0.875rem;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
  }

  .veto-label {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.5);
    margin-bottom: 0.5rem;
  }

  .veto-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.3125rem;
  }

  .veto-list li {
    display: flex;
    gap: 0.5rem;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: rgba(255, 255, 255, 0.78);
  }

  .veto-num {
    flex-shrink: 0;
    width: 1.125rem;
    font-variant-numeric: tabular-nums;
    color: rgba(255, 255, 255, 0.4);
  }

  /* Watch */
  .watch {
    border-left: 1px solid rgba(255, 255, 255, 0.07);
    /* Stretch to the taller pane so the rule runs the full card height. */
    align-self: stretch;
  }

  .watch-head {
    display: flex;
    align-items: center;
    gap: 0.4375rem;
    padding: 1rem 1rem 0.625rem;
    color: var(--accent-text);
  }

  .watch-label {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.5);
  }

  .watch-empty {
    padding: 0 1rem 1rem;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .watch-list {
    display: flex;
    flex-direction: column;
    padding-bottom: 0.375rem;
  }

  .watch-item {
    display: flex;
    align-items: center;
    gap: 0.6875rem;
    padding: 0.75rem 1rem;
    text-decoration: none;
    color: var(--text);
    transition: background 0.15s;
  }

  .watch-item + .watch-item {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .watch-item:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  :global(.watch-icon) {
    flex-shrink: 0;
    color: var(--accent-text);
  }

  .watch-body {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .watch-name {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .watch-pill {
    font-size: 0.5625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.0625rem 0.3125rem;
    border-radius: 0.25rem;
    background: rgba(59, 130, 246, 0.2);
    color: #93c5fd;
  }

  .watch-url {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.45);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .watch-status {
    flex-shrink: 0;
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.5);
  }

  /* Map tabs */
  .map-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    margin-bottom: 1rem;
  }

  .map-tab {
    display: flex;
    align-items: baseline;
    gap: 0.375rem;
    padding: 0.4375rem 0.75rem;
    border-radius: 0.4375rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.72);
    font-size: 0.8125rem;
    cursor: pointer;
    transition:
      background 0.15s,
      border-color 0.15s,
      color 0.15s;
  }

  .map-tab:hover {
    background: rgba(255, 255, 255, 0.07);
    color: var(--text);
  }

  .map-tab-active {
    background: var(--accent);
    border-color: rgba(120, 67, 145, 0.6);
    color: var(--text);
  }

  .map-tab-label {
    font-weight: 600;
  }

  .map-tab-sub {
    font-size: 0.6875rem;
    opacity: 0.7;
  }

  .map-tab-void .map-tab-label,
  .map-tab-void .map-tab-sub {
    text-decoration: line-through;
  }

  .map-tab-ff {
    font-size: 0.625rem;
    font-weight: 800;
    color: #fca5a5;
  }

  .map-score {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1rem;
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.65);
  }

  .map-score b {
    font-weight: 700;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  .map-score-void {
    opacity: 0.65;
  }

  .void-pill {
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    background: rgba(248, 113, 113, 0.18);
    color: #fca5a5;
  }

  .map-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .map-chip {
    padding: 0.5rem 0.875rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.09);
    background: rgba(255, 255, 255, 0.03);
    min-width: 6.5rem;
  }

  .map-chip-void {
    border-color: rgba(248, 113, 113, 0.22);
    background: rgba(248, 113, 113, 0.05);
    opacity: 0.65;
  }

  .map-chip-head {
    display: flex;
    align-items: baseline;
    gap: 0.3125rem;
    font-size: 0.75rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.85);
  }

  .map-chip-name {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .map-chip-score {
    margin-top: 0.1875rem;
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  /* Stat tables */
  .stat-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  .stat-block {
    min-width: 0;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }

  .stat-block-head {
    padding: 0.5rem 0.75rem;
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--text);
    background: rgba(255, 255, 255, 0.04);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .table-scroll {
    overflow-x: auto;
  }

  .stat-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }

  .stat-table th {
    padding: 0.4375rem 0.625rem;
    text-align: right;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.5);
    white-space: nowrap;
  }

  .stat-table td {
    padding: 0.4375rem 0.625rem;
    color: rgba(255, 255, 255, 0.82);
    white-space: nowrap;
  }

  .stat-table tbody tr {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .stat-table tbody tr:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .stat-table .col-player,
  .stat-table .col-agent {
    text-align: left;
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .num-strong {
    font-weight: 700;
    color: var(--text);
  }

  .player-link {
    font-weight: 600;
    color: var(--text);
    text-decoration: none;
    transition: color 0.15s;
  }

  .player-link:hover {
    color: var(--accent-text);
    text-decoration: underline;
  }

  .agents {
    display: flex;
    gap: 0.1875rem;
  }

  .agent-icon {
    width: 1.375rem;
    height: 1.375rem;
    border-radius: 0.25rem;
    object-fit: contain;
  }

  .agent-text {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.6);
  }

  /* Responsive */
  @media (max-width: 1280px) {
    .stat-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 768px) {
    /* Panes stack, so the divider moves from the side to the top. */
    .info-split {
      grid-template-columns: minmax(0, 1fr);
    }

    .watch {
      border-left: none;
      border-top: 1px solid rgba(255, 255, 255, 0.07);
    }
  }

  @media (max-width: 640px) {
    .match-page {
      padding: 1rem 0.75rem 2rem;
    }

    .scoreboard {
      padding: 1rem 0.875rem 0.875rem;
    }

    .sb-row {
      gap: 0.625rem;
      /* A name that wraps to two lines must not shove its logo out of line. */
      align-items: start;
    }

    .sb-team {
      flex-direction: column;
      gap: 0.4375rem;
      text-align: center;
    }

    .sb-team-b {
      flex-direction: column;
    }

    /*
     * Both sides stack, so neither needs the mirrored order. Wrapping lets the
     * rank chip drop below a long name instead of taking width from it — each
     * side only gets ~107px here.
     */
    .sb-name-block,
    .sb-team-b .sb-name-block {
      flex-direction: row;
      justify-content: center;
      flex-wrap: wrap;
      max-width: 100%;
    }

    .sb-logo {
      width: 2.75rem;
      height: 2.75rem;
    }

    .sb-name {
      font-size: 0.875rem;
      white-space: normal;
      /*
       * As a flex item the name would otherwise refuse to shrink below its
       * longest word, pushing the whole block past the side it sits in — a
       * single-word name like "Perc30FishStick" is wider than the column.
       */
      min-width: 0;
      overflow-wrap: break-word;
    }

    .sb-num {
      font-size: 1.875rem;
    }

    :global(.sb-admin) {
      margin-left: auto;
    }
  }
</style>
