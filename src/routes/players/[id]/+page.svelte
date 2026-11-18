<script lang="ts">
  import type { PageProps } from './$types'
  import { formatLeftDay } from '$lib/players/roster-dates'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import BatchPicker from '$lib/components/stats/BatchPicker.svelte'
  import ExternalEventsToggle from '$lib/components/ExternalEventsToggle.svelte'
  import { externalEvents } from '$lib/stores/external-events.svelte'
  import CommentThread from '$lib/components/CommentThread.svelte'
  import ReviewFlagButton from '$lib/components/ReviewFlagButton.svelte'
  import RiotAccountsPanel from '$lib/components/RiotAccountsPanel.svelte'
  import { User } from 'lucide-svelte'
  import { resolve } from '$app/paths'
  import { agentIconUrl, rankIconUrlByKey } from '$lib/icons'
  import { builtInAccoladeIcons } from '$lib/accolades/icons'
  import { enhance } from '$app/forms'
  import { rankImageKey, rankLabel } from '$lib/ranks/ranks'

  let { data, form }: PageProps = $props()

  const player = $derived(data.player)
  const activeTeam = $derived(data.activeTeam)
  const viewer = $derived(data.viewer ?? { canEditRiotIdBase: false })
  const selected = $derived((data.stats?.selected ?? null) as any | null)
  const selectedBatchId = $derived((data.stats?.selectedBatchId ?? null) as string | null)
  const statBatches = $derived(data.stats?.batches ?? [])
  const batchEvents = $derived(data.stats?.batchEvents ?? [])
  // External events (Shitter League) are hidden unless shown — except when the
  // picked stats table is one, which already scopes everything to that event.
  const externalSeasonIds = $derived(new Set((data.externalSeasonIds ?? []) as string[]))
  const selectedEvent = $derived(statBatches.find((b) => b.id === selectedBatchId)?.event ?? null)
  const viewingExternal = $derived(
    batchEvents.some((ev) => ev.name === selectedEvent && ev.external)
  )
  const hideExternal = $derived(!externalEvents.show && !viewingExternal)
  const isExternalSeason = (id: string | null | undefined) =>
    Boolean(id) && externalSeasonIds.has(id as string)
  const allMatchHistory = $derived((data.matchHistory ?? []) as any[])
  const allTeamHistory = $derived(data.teamHistory ?? [])
  const hasExternalContent = $derived(
    allTeamHistory.some((e) => isExternalSeason(e.season?.id)) ||
      allMatchHistory.some((e) => isExternalSeason(e.match?.season_id)) ||
      batchEvents.some((ev) => ev.external && statBatches.some((b) => b.event === ev.name))
  )
  const matchHistory = $derived(
    hideExternal
      ? allMatchHistory.filter((e) => !isExternalSeason(e.match?.season_id))
      : allMatchHistory
  )
  const teamHistory = $derived(
    hideExternal ? allTeamHistory.filter((e) => !isExternalSeason(e.season?.id)) : allTeamHistory
  )
  const activeSeasonId = $derived((data.activeSeasonId ?? null) as string | null)
  // Defaults to the full history; "This Season" narrows it to the active
  // season, and is hidden when none is configured.
  let teamHistoryScope = $state<'season' | 'all'>('all')
  const currentSeasonTeams = $derived(
    teamHistory.filter((entry) => entry.season?.id === activeSeasonId)
  )
  const shownTeamHistory = $derived(
    activeSeasonId && teamHistoryScope === 'season' ? currentSeasonTeams : teamHistory
  )
  const mapStats = $derived(
    (data.mapStats ?? []) as Array<{
      key: string
      maps_played: number
      maps_won: number
      maps_decided: number
      rounds: number
      acs: number | null
      kills: number
      deaths: number
      assists: number
      kd: number | null
      adr: number | null
      kast_pct: number | null
      hs_pct: number | null
      fk: number
      fd: number
      win_pct: number | null
    }>
  )
  type BreakdownRow = {
    key: string
    maps_played: number
    maps_won: number
    maps_decided: number
    rounds: number
    acs: number | null
    kills: number
    deaths: number
    assists: number
    kd: number | null
    adr: number | null
    kast_pct: number | null
    hs_pct: number | null
    fk: number
    fd: number
    win_pct: number | null
  }
  const agentStats = $derived((data.agentStats ?? []) as BreakdownRow[])
  const mapArt = $derived((data.mapArt ?? {}) as Record<string, string>)
  const mapStatsMain = $derived((data.mapStatsMain ?? []) as BreakdownRow[])
  const agentStatsMain = $derived((data.agentStatsMain ?? []) as BreakdownRow[])
  const mapStatsSub = $derived((data.mapStatsSub ?? []) as BreakdownRow[])
  const agentStatsSub = $derived((data.agentStatsSub ?? []) as BreakdownRow[])
  const rosterSplit = $derived(
    (data.rosterSplit ?? { subGames: 0, mainGames: 0 }) as { subGames: number; mainGames: number }
  )

  // The All / Main / Sub filter only appears once the player has actually
  // appeared in both roles; otherwise the split carries no information.
  const canFilterRoster = $derived(rosterSplit.subGames > 0 && rosterSplit.mainGames > 0)
  let rosterFilter = $state<'all' | 'main' | 'sub'>('all')

  const shownMapStats = $derived(
    rosterFilter === 'sub' ? mapStatsSub : rosterFilter === 'main' ? mapStatsMain : mapStats
  )
  const shownAgentStats = $derived(
    rosterFilter === 'sub' ? agentStatsSub : rosterFilter === 'main' ? agentStatsMain : agentStats
  )
  const rosterTotals = $derived(
    (data.rosterTotals ?? null) as {
      main: Omit<BreakdownRow, 'key'>
      sub: Omit<BreakdownRow, 'key'>
    } | null
  )

  // Swaps the overall KPI tiles for a Main vs Sub comparison. Leaderboard
  // batches carry no starter/sub split, so both sides come from per-map stats.
  // Only for a batch scoped to imported matches that include sub appearances.
  const canCompareRoster = $derived(
    Boolean(data.rosterCompareScoped) && canFilterRoster && rosterTotals !== null
  )
  let compareRoster = $state(false)
  const rosterCompare = $derived.by(() => {
    if (!compareRoster || !canCompareRoster || !rosterTotals) return null
    const { main, sub } = rosterTotals
    return [
      {
        label: 'Matches',
        main: rosterSplit.mainGames,
        sub: rosterSplit.subGames,
        digits: 0,
        higher: null,
      },
      { label: 'ACS', main: main.acs, sub: sub.acs, digits: 0, higher: true },
      { label: 'K/D', main: main.kd, sub: sub.kd, digits: 2, higher: true },
      { label: 'ADR', main: main.adr, sub: sub.adr, digits: 0, higher: true },
      { label: 'HS%', main: main.hs_pct, sub: sub.hs_pct, digits: 0, higher: true },
      { label: 'Win%', main: main.win_pct, sub: sub.win_pct, digits: 0, higher: true },
    ] as Array<{
      label: string
      main: number | null
      sub: number | null
      digits: number
      higher: boolean | null
    }>
  })

  // Which side of a comparison row is better, for highlighting; null on a tie,
  // a missing value, or a row (like match count) that has no "better".
  // Compared at display precision so two values that read the same never differ.
  function betterSide(row: {
    main: number | null
    sub: number | null
    digits: number
    higher: boolean | null
  }) {
    if (row.higher == null || row.main == null || row.sub == null) return null
    const m = Number(row.main.toFixed(row.digits))
    const s = Number(row.sub.toFixed(row.digits))
    if (m === s) return null
    return m > s ? 'main' : 'sub'
  }

  const shownMatchHistory = $derived(
    rosterFilter === 'all'
      ? matchHistory
      : matchHistory.filter((e) => (rosterFilter === 'sub' ? e.is_sub : !e.is_sub))
  )

  // The 10 most recent matches show by default; the rest sit behind an explicit
  // toggle rather than a scroll area inside the card, which reads as the whole list.
  // Same win rule as the rows' W/L badge, over the filtered list rather than the
  // visible slice, so it agrees with the match count beside it.
  const matchRecord = $derived.by(() => {
    let wins = 0
    for (const e of shownMatchHistory) if (e.score.us > e.score.them) wins++
    return { wins, losses: shownMatchHistory.length - wins }
  })

  const MATCH_HISTORY_PREVIEW = 10
  let showAllMatches = $state(false)
  const visibleMatchHistory = $derived(
    showAllMatches ? shownMatchHistory : shownMatchHistory.slice(0, MATCH_HISTORY_PREVIEW)
  )

  const mapStatsScope = $derived((data.mapStatsScope ?? null) as string | null)
  const accolades = $derived(
    (data.accolades ?? []) as Array<{
      id: string
      name: string
      icon_key: string | null
      context: string | null
      logo_url: string | null
    }>
  )

  let riotIdBaseValue = $state('')
  let statsPlayerNameValue = $state('')
  $effect(() => {
    riotIdBaseValue = player.riot_id_base ?? ''
    statsPlayerNameValue = player.stats_player_name ?? ''
  })

  function rankIconUrl(leagueRank: unknown): string | null {
    if (typeof leagueRank !== 'string') return null
    return rankIconUrlByKey(rankImageKey(leagueRank))
  }

  const playerRank = $derived(rankLabel((data.bestRank ?? null) as string | null))

  function parseAgents(value: unknown): string[] {
    if (typeof value !== 'string') return []
    const tokens = value
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
    return Array.from(new Set(tokens))
  }

  function fmt(n: unknown, digits = 1) {
    const v = Number(n)
    if (!Number.isFinite(v)) return '—'
    return v.toFixed(digits)
  }

  function navToBatch(batchId: string) {
    window.location.href = `/players/${player.profile_id}?batchId=${encodeURIComponent(batchId)}`
  }

  function teamName(value: unknown) {
    if (!value) return 'Team'
    if (Array.isArray(value)) return (value[0] as { name?: string } | undefined)?.name ?? 'Team'
    return (value as { name?: string }).name ?? 'Team'
  }

  // Only events that have at least one batch reach the picker.
  const pickerEvents = $derived(
    batchEvents.filter(
      (ev) =>
        statBatches.some((b) => b.event === ev.name) &&
        (!ev.external || !hideExternal || ev.name === selectedEvent)
    )
  )

  // Map / Agent switch for the single Breakdown section.
  let breakdownView = $state<'map' | 'agent'>('map')
  const hasBreakdown = $derived(mapStats.length > 0 || agentStats.length > 0)
  const shownBreakdownView = $derived(
    breakdownView === 'map' && mapStats.length === 0
      ? 'agent'
      : breakdownView === 'agent' && agentStats.length === 0
        ? 'map'
        : breakdownView
  )

  // One line under the filter bar saying what each control reaches, in place of
  // the separate notes the stat cards used to carry.
  const scopeNote = $derived.by(() => {
    const below = mapStatsScope
      ? `Breakdown and matches: ${mapStatsScope} only.`
      : 'Breakdown and matches use every recorded map.'
    if (rosterCompare) {
      return `Main vs Sub compares recorded matches${mapStatsScope ? ` in ${mapStatsScope}` : ''}; the roster filter applies to matches.`
    }
    return selected ? `Batch sets the totals above. ${below}` : below
  })

  const showFilterBar = $derived(
    pickerEvents.length > 0 || canFilterRoster || canCompareRoster || hasExternalContent
  )
</script>

<svelte:head><title>{player.riot_id}</title></svelte:head>

<!-- One Main / Sub value pair inside a comparison table cell. -->
{#snippet pairCell(
  main: number | null | undefined,
  sub: number | null | undefined,
  digits: number,
  suffix: string,
  ranked: boolean
)}
  {@const better = ranked
    ? betterSide({ main: main ?? null, sub: sub ?? null, digits, higher: true })
    : null}
  <span class="pair">
    <span class="pair-val" class:compare-better={better === 'main'}
      >{main == null ? '—' : `${fmt(main, digits)}${suffix}`}</span
    >
    <span class="pair-val pair-sub" class:compare-better={better === 'sub'}
      >{sub == null ? '—' : `${fmt(sub, digits)}${suffix}`}</span
    >
  </span>
{/snippet}

<!-- Map / Agent breakdown with each stat split into Main and Sub columns. Rows
     follow the combined table's order so toggling keeps rows where they were. -->
{#snippet compareTable(
  label: string,
  rows: BreakdownRow[],
  mainRows: BreakdownRow[],
  subRows: BreakdownRow[],
  withIcon: boolean
)}
  {@const mainByKey = new Map(mainRows.map((r) => [r.key, r]))}
  {@const subByKey = new Map(subRows.map((r) => [r.key, r]))}
  <div class="table-box">
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th class="col-left">{label}</th>
            <th>Played</th>
            <th>Win%</th>
            <th>ACS</th>
            <th>K/D</th>
            <th>ADR</th>
            <th>KAST</th>
            <th>HS%</th>
          </tr>
          <tr class="pair-head">
            <th class="col-left"></th>
            {#each Array(7) as _, i (i)}
              <th>
                <span class="pair"
                  ><span class="pair-val">Main</span><span class="pair-val pair-sub">Sub</span
                  ></span
                >
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each rows as entry (entry.key)}
            {@const m = mainByKey.get(entry.key)}
            {@const s = subByKey.get(entry.key)}
            <tr>
              <td class="col-left">
                {@render entryKey(entry.key, withIcon)}
              </td>
              <td class="num"
                >{@render pairCell(m?.maps_played ?? 0, s?.maps_played ?? 0, 0, '', false)}</td
              >
              <td class="num">{@render pairCell(m?.win_pct, s?.win_pct, 0, '%', true)}</td>
              <td class="num num-strong">{@render pairCell(m?.acs, s?.acs, 0, '', true)}</td>
              <td class="num">{@render pairCell(m?.kd, s?.kd, 2, '', true)}</td>
              <td class="num">{@render pairCell(m?.adr, s?.adr, 0, '', true)}</td>
              <td class="num">{@render pairCell(m?.kast_pct, s?.kast_pct, 0, '%', true)}</td>
              <td class="num">{@render pairCell(m?.hs_pct, s?.hs_pct, 0, '%', true)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
{/snippet}

<!-- Row label for a breakdown table: map thumbnail or agent icon, then the name. -->
{#snippet entryKey(key: string, isAgent: boolean)}
  {@const icon = isAgent ? agentIconUrl(key) : (mapArt[key.toLowerCase()] ?? null)}
  <span class="entry-key">
    {#if icon}
      <img src={icon} alt="" class={isAgent ? 'agent-icon' : 'map-thumb'} />
    {/if}
    {key}
  </span>
{/snippet}

{#snippet breakdownTable(label: string, rows: BreakdownRow[], withIcon: boolean)}
  <div class="table-box">
    {#if rows.length === 0}
      <p class="card-empty">
        No {label.toLowerCase()} data for {rosterFilter === 'sub' ? 'substitute' : 'main-roster'} appearances
        in this scope.
      </p>
    {:else}
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th class="col-left">{label}</th>
              <th>Played</th>
              <th>Win%</th>
              <th>ACS</th>
              <th>K/D</th>
              <th>ADR</th>
              <th>KAST</th>
              <th>HS%</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as entry (entry.key)}
              <tr>
                <td class="col-left">
                  {@render entryKey(entry.key, withIcon)}
                </td>
                <td class="num">{entry.maps_played}</td>
                <td class="num">
                  {#if entry.win_pct != null}
                    {fmt(entry.win_pct, 0)}%
                    <span
                      class="record"
                      title="Maps won–lost. Maps with no recorded result are excluded."
                    >
                      {entry.maps_won}–{entry.maps_decided - entry.maps_won}
                    </span>
                  {:else}
                    —
                  {/if}
                </td>
                <td class="num num-strong">{fmt(entry.acs, 0)}</td>
                <td class="num">{fmt(entry.kd, 2)}</td>
                <td class="num">{fmt(entry.adr, 0)}</td>
                <td class="num">{fmt(entry.kast_pct, 0)}%</td>
                <td class="num">{fmt(entry.hs_pct, 0)}%</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
{/snippet}

<PageContainer>
  <div class="player-page">
    <article class="sheet">
      <!-- Identity: the top of the sheet -->
      <header class="hero">
        <div class="hero-top">
          {#if activeTeam?.logo_url}
            <img src={activeTeam.logo_url} alt="{activeTeam.name} logo" class="hero-logo" />
          {:else}
            <div class="hero-logo hero-logo-empty">
              <User size={34} />
            </div>
          {/if}
          <div class="hero-id">
            <div class="hero-name-row">
              <h1 class="hero-name">{player.riot_id}</h1>
              {#if playerRank}
                {@const rUrl = rankIconUrl(playerRank)}
                {#if rUrl}
                  <img
                    src={rUrl}
                    alt="All-time peak: {playerRank}"
                    title="All-time peak: {playerRank}"
                    class="hero-rank"
                  />
                {/if}
              {/if}
              {#if accolades.length > 0}
                <span class="hero-divider" aria-hidden="true"></span>
              {/if}
              {#each accolades as accolade, i (accolade.id + '-' + i)}
                {@const iconSrc = accolade.icon_key
                  ? (builtInAccoladeIcons[accolade.icon_key] ?? null)
                  : null}
                {@const tooltip = accolade.context
                  ? `${accolade.name} — ${accolade.context}`
                  : accolade.name}
                {#if iconSrc || accolade.logo_url}
                  <img
                    src={iconSrc ?? accolade.logo_url}
                    alt={accolade.name}
                    title={tooltip}
                    class="accolade-icon"
                  />
                {:else}
                  <span class="accolade-chip" title={tooltip}>{accolade.name}</span>
                {/if}
              {/each}
            </div>
            {#if activeTeam}
              <a href={resolve(`/teams/${activeTeam.id}`)} class="identity-team">
                <span class="identity-team-name">{activeTeam.name}</span>
                {#if activeTeam.tag}
                  <span class="identity-dim">[{String(activeTeam.tag).toUpperCase()}]</span>
                {/if}
                {#if activeTeam.role && activeTeam.role !== 'player'}
                  <span class="identity-role">{activeTeam.role}</span>
                {/if}
              </a>
            {:else}
              <span class="identity-none">No active team</span>
            {/if}
          </div>
          <div class="hero-actions">
            <ReviewFlagButton
              entityType="player"
              entityId={player.profile_id}
              viewerId={data.viewer?.profileId ?? null}
              noun="profile"
            />
          </div>
        </div>

        <!-- Player info: a collapsible row of the sheet -->
        <RiotAccountsPanel
          accounts={data.riotAccounts ?? []}
          canEdit={viewer.canEditRiotIdBase}
          displayName={player.display_name}
          discordHandle={player.discord_handle}
          variant="flush"
        />

        <!-- Owner-only callout rows -->
        {#if viewer.canEditRiotIdBase && !player.riot_id_base}
          <form class="callout" method="POST" use:enhance>
            <div class="callout-text">
              <label for="riot-id-base" class="callout-title">Link your stats</label>
              <span class="callout-hint"
                >Your Riot name without the #tag. Stat imports match on this. Only you see this.</span
              >
              {#if form?.success === false}
                <span class="callout-error">{form.message ?? 'Failed to save'}</span>
              {/if}
            </div>
            <div class="callout-controls">
              <input
                id="riot-id-base"
                name="riot_id_base"
                bind:value={riotIdBaseValue}
                class="callout-input"
                placeholder="Example: Ginzburg"
                autocomplete="off"
              />
              <button type="submit" formaction="?/setRiotIdBase" class="callout-btn">Save</button>
            </div>
          </form>
        {/if}

        {#if viewer.canEditRiotIdBase && player.has_unmatched_stats_candidate}
          <form class="callout" method="POST" use:enhance>
            <div class="callout-text">
              <label for="stats-player-name" class="callout-title">Alternate stats name</label>
              <span class="callout-hint"
                >For imported stats that still list an old Riot or display name. Also relinks past
                imports. Only you see this.</span
              >
            </div>
            <div class="callout-controls">
              <input
                id="stats-player-name"
                name="stats_player_name"
                bind:value={statsPlayerNameValue}
                class="callout-input"
                placeholder="Example: OldName"
                autocomplete="off"
              />
              <button type="submit" formaction="?/setStatsPlayerName" class="callout-btn"
                >Save</button
              >
            </div>
          </form>
        {/if}

        <!-- KPI strip docked to the hero's bottom edge -->
        {#if rosterCompare}
          <div class="kpi-strip">
            {#each rosterCompare as row (row.label)}
              {@const better = betterSide(row)}
              {@const suffix = row.label.endsWith('%') ? '%' : ''}
              <div class="kpi">
                <span class="kpi-label">{row.label}</span>
                <span class="kpi-pair">
                  <span class="kpi-pair-side">
                    <span class="kpi-value" class:compare-better={better === 'main'}
                      >{row.main == null ? '—' : `${fmt(row.main, row.digits)}${suffix}`}</span
                    >
                    <span class="kpi-pair-tag">Main</span>
                  </span>
                  <span class="kpi-pair-side">
                    <span class="kpi-value kpi-value-sub" class:compare-better={better === 'sub'}
                      >{row.sub == null ? '—' : `${fmt(row.sub, row.digits)}${suffix}`}</span
                    >
                    <span class="kpi-pair-tag">Sub</span>
                  </span>
                </span>
              </div>
            {/each}
          </div>
        {:else if !selected}
          <p class="kpi-empty">No imported stats found for this player.</p>
        {:else}
          {@const pool = parseAgents(selected.agents)}
          <div class="kpi-strip">
            <div class="kpi">
              <span class="kpi-label">Games</span>
              <span class="kpi-value">{selected.games ?? '—'}</span>
            </div>
            <div class="kpi">
              <span class="kpi-label">ACS</span>
              <span class="kpi-value">{fmt(selected.acs, 0)}</span>
            </div>
            <div class="kpi">
              <span class="kpi-label">K/D</span>
              <span class="kpi-value">{fmt(selected.kd, 2)}</span>
            </div>
            <div class="kpi">
              <span class="kpi-label">ADR</span>
              <span class="kpi-value">{fmt(selected.adr, 0)}</span>
            </div>
            <div class="kpi">
              <span class="kpi-label">HS%</span>
              <span class="kpi-value">{fmt(selected.hs_pct, 0)}%</span>
            </div>
            {#if pool.length > 0}
              <div class="kpi kpi-agents">
                <span class="kpi-label">Agents</span>
                <span class="agents-icons">
                  {#each pool as agent (agent)}
                    {@const url = agentIconUrl(agent)}
                    {#if url}
                      <img src={url} alt={agent} title={agent} class="agent-tile" />
                    {:else}
                      <span class="agent-tile agent-tile-text" title={agent}>
                        {agent.slice(0, 3).toUpperCase()}
                      </span>
                    {/if}
                  {/each}
                </span>
              </div>
            {/if}
          </div>
        {/if}
      </header>

      <!-- One filter bar for every scope control -->
      {#if showFilterBar}
        <div class="filter-bar">
          {#if pickerEvents.length > 0}
            <div class="filter-item filter-item-batch">
              <span class="filter-label">Stats</span>
              <BatchPicker
                batches={statBatches}
                events={pickerEvents}
                batchId={selectedBatchId}
                onPick={navToBatch}
              />
            </div>
          {/if}

          {#if canFilterRoster}
            <div class="filter-item">
              <span class="filter-label">Roster</span>
              <div class="seg" role="group" aria-label="Filter by roster role">
                <button
                  type="button"
                  class="seg-btn"
                  class:seg-on={rosterFilter === 'all'}
                  onclick={() => (rosterFilter = 'all')}
                >
                  All
                </button>
                <button
                  type="button"
                  class="seg-btn"
                  class:seg-on={rosterFilter === 'main'}
                  onclick={() => (rosterFilter = 'main')}
                >
                  Main <span class="seg-count">{rosterSplit.mainGames}</span>
                </button>
                <button
                  type="button"
                  class="seg-btn"
                  class:seg-on={rosterFilter === 'sub'}
                  onclick={() => (rosterFilter = 'sub')}
                >
                  Sub <span class="seg-count">{rosterSplit.subGames}</span>
                </button>
              </div>
            </div>
          {/if}

          {#if canCompareRoster}
            <button
              type="button"
              class="toggle-btn"
              class:toggle-btn-on={compareRoster}
              aria-pressed={compareRoster}
              onclick={() => (compareRoster = !compareRoster)}
            >
              Main vs Sub
            </button>
          {/if}

          {#if hasExternalContent && !viewingExternal}
            <ExternalEventsToggle label="External events" />
          {/if}

          <span class="filter-note">{scopeNote}</span>
        </div>
      {/if}

      <!-- Team History -->
      <section class="sheet-section">
        <div class="sheet-head">
          <h2 class="sheet-title">Team History</h2>
          {#if activeSeasonId && teamHistory.length > 0}
            <div class="seg head-end" role="group" aria-label="Team history scope">
              <button
                type="button"
                class="seg-btn"
                class:seg-on={teamHistoryScope === 'season'}
                onclick={() => (teamHistoryScope = 'season')}
              >
                This Season <span class="seg-count">{currentSeasonTeams.length}</span>
              </button>
              <button
                type="button"
                class="seg-btn"
                class:seg-on={teamHistoryScope === 'all'}
                onclick={() => (teamHistoryScope = 'all')}
              >
                All Time <span class="seg-count">{teamHistory.length}</span>
              </button>
            </div>
          {/if}
        </div>

        {#if teamHistory.length === 0}
          <p class="card-empty">Not rostered on a team yet.</p>
        {:else if shownTeamHistory.length === 0}
          <p class="card-empty">Not rostered on a team this season.</p>
        {:else}
          <div class="team-rows">
            {#each shownTeamHistory as entry (entry.team.id)}
              <a href={resolve(`/teams/${entry.team.id}`)} class="team-row">
                {#if entry.team.logo_url}
                  <img src={entry.team.logo_url} alt="" class="row-logo" />
                {:else}
                  <span class="row-logo row-logo-empty"></span>
                {/if}

                <span class="team-row-name">
                  {entry.team.name}
                  {#if entry.team.tag}
                    <span class="team-row-tag">{entry.team.tag}</span>
                  {/if}
                </span>

                {#if entry.role && entry.role !== 'player'}
                  <span class="team-row-role">{entry.role}</span>
                {/if}

                {#if entry.placement || entry.is_mvp}
                  <span class="team-row-awards">
                    {#if entry.placement === 'champion'}
                      <span class="team-row-award" title="Season champions">
                        <img src={builtInAccoladeIcons.trophy} alt="" />
                        <span class="team-row-award-label">Champions</span>
                      </span>
                    {:else if entry.placement === 'runner_up'}
                      <span class="team-row-award" title="Season runner-up">
                        <img src={builtInAccoladeIcons.silver_medal} alt="" />
                        <span class="team-row-award-label">Runner-up</span>
                      </span>
                    {:else if entry.placement === 'third'}
                      <span class="team-row-award" title="Season 3rd place">
                        <img src={builtInAccoladeIcons.bronze_medal} alt="" />
                        <span class="team-row-award-label">3rd</span>
                      </span>
                    {/if}
                    {#if entry.is_mvp}
                      <span class="team-row-award" title="Season MVP">
                        <img src={builtInAccoladeIcons.mvp_trophy} alt="" />
                        <span class="team-row-award-label">MVP</span>
                      </span>
                    {/if}
                  </span>
                {/if}

                <span class="team-row-season">
                  {#if entry.left_at}
                    <span class="team-row-left">left {formatLeftDay(entry.left_at)} ·</span>
                  {/if}
                  {entry.season?.name ?? 'Unassigned season'}
                </span>
              </a>
            {/each}
          </div>
        {/if}
      </section>

      <!-- Breakdown: Map Stats and Agent Stats behind one switch -->
      {#if hasBreakdown}
        <section class="sheet-section">
          <div class="sheet-head">
            <h2 class="sheet-title">Breakdown</h2>
            {#if mapStats.length > 0 && agentStats.length > 0}
              <div class="seg head-end" role="group" aria-label="Break down by">
                <button
                  type="button"
                  class="seg-btn"
                  class:seg-on={shownBreakdownView === 'map'}
                  aria-pressed={shownBreakdownView === 'map'}
                  onclick={() => (breakdownView = 'map')}
                >
                  Map
                </button>
                <button
                  type="button"
                  class="seg-btn"
                  class:seg-on={shownBreakdownView === 'agent'}
                  aria-pressed={shownBreakdownView === 'agent'}
                  onclick={() => (breakdownView = 'agent')}
                >
                  Agent
                </button>
              </div>
            {/if}
          </div>
          {#if shownBreakdownView === 'map'}
            {#if rosterCompare}
              {@render compareTable('Map', mapStats, mapStatsMain, mapStatsSub, false)}
            {:else}
              {@render breakdownTable('Map', shownMapStats, false)}
            {/if}
          {:else if rosterCompare}
            {@render compareTable('Agent', agentStats, agentStatsMain, agentStatsSub, true)}
          {:else}
            {@render breakdownTable('Agent', shownAgentStats, true)}
          {/if}
        </section>
      {/if}

      <!-- Match History -->
      <section class="sheet-section">
        <div class="sheet-head">
          <h2 class="sheet-title">Match History</h2>
          {#if shownMatchHistory.length > 0}
            <span class="head-end head-record" title="Wins – losses">
              <b class="record-win">{matchRecord.wins}W</b>
              <span class="score-sep">–</span>
              <b class="record-loss">{matchRecord.losses}L</b>
              <span class="head-record-count"
                >· {shownMatchHistory.length} match{shownMatchHistory.length === 1
                  ? ''
                  : 'es'}</span
              >
            </span>
          {/if}
        </div>

        {#if matchHistory.length === 0}
          <p class="card-empty">
            {mapStatsScope
              ? `No matches recorded in ${mapStatsScope}.`
              : 'No participation stats recorded yet.'}
          </p>
        {:else if shownMatchHistory.length === 0}
          <p class="card-empty">
            No {rosterFilter === 'sub' ? 'substitute' : 'main-roster'} appearances recorded.
          </p>
        {:else}
          <div class="match-grid match-head" aria-hidden="true">
            <span></span><span></span><span>Opponent</span>
            <span class="row-hide-sm">Agents</span>
            <span class="num">ACS</span>
            <span class="num">K/D/A</span>
            <span class="num row-hide-sm">KAST</span>
            <span class="num row-hide-sm">HS</span>
            <span class="num">Score</span>
          </div>
          <div class="match-rows">
            {#each visibleMatchHistory as entry (entry.match.id)}
              {@const match = entry.match}
              {@const opp = entry.opponent}
              {@const score = entry.score}
              {@const won = score.us > score.them}
              <a href={resolve(`/matches/${match.id}`)} class="match-grid match-row">
                <span class="row-badge" class:row-win={won} class:row-loss={!won}>
                  {won ? 'W' : 'L'}
                </span>

                {#if opp?.logo_url}
                  <img src={opp.logo_url} alt="" class="row-logo" />
                {:else}
                  <span class="row-logo row-logo-empty"></span>
                {/if}

                <span class="row-name">
                  {teamName(opp)}
                  {#if entry.is_sub}
                    <span class="sub-badge" title="Played as a substitute in this match">SUB</span>
                  {/if}
                </span>

                <span class="row-agents row-hide-sm">
                  {#each parseAgents(entry.agents) as agent (agent)}
                    {@const url = agentIconUrl(agent)}
                    {#if url}
                      <img src={url} alt={agent} title={agent} class="agent-icon" />
                    {:else}
                      <span class="agent-icon agent-icon-text" title={agent}>
                        {agent.slice(0, 3).toUpperCase()}
                      </span>
                    {/if}
                  {/each}
                </span>

                <span class="num num-strong" title="Average combat score">{fmt(entry.acs, 0)}</span>
                <span class="num">
                  {entry.kills ?? 0}/{entry.deaths ?? 0}/{entry.assists ?? 0}
                </span>
                <span class="num row-hide-sm">{fmt(entry.kast_pct, 0)}%</span>
                <span class="num row-hide-sm">{fmt(entry.hs_pct, 0)}%</span>

                <span class="row-score">
                  <b class:score-win={won}>{score.us}</b>
                  <span class="score-sep">–</span>
                  <b class:score-win={!won}>{score.them}</b>
                </span>
              </a>
            {/each}
          </div>
          {#if shownMatchHistory.length > MATCH_HISTORY_PREVIEW}
            <button
              type="button"
              class="match-rows-more"
              aria-expanded={showAllMatches}
              onclick={() => (showAllMatches = !showAllMatches)}
            >
              {showAllMatches ? 'Show less' : `Show all ${shownMatchHistory.length} matches`}
            </button>
          {/if}
        {/if}
      </section>

      <CommentThread
        entityType="player"
        entityId={player.profile_id}
        comments={data.comments ?? []}
        viewerId={data.viewer?.profileId ?? null}
        isAdmin={data.viewer?.isAdmin ?? false}
        variant="flush"
      />
    </article>
  </div>
</PageContainer>

<style>
  .player-page {
    width: 100%;
    /*
     * The widest thing here is a stat table that needs ~510px; at 80rem the
     * columns were stretched across a third more space than they had content
     * for. 64rem still clears everything without truncation.
     */
    max-width: 64rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 3rem;
  }

  /* Identity: the top of the sheet, no card or wash of its own. */
  .hero-top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem 1.125rem;
    padding: 1.5rem 1.5rem 1.25rem;
  }

  .hero-logo {
    width: 4.75rem;
    height: 4.75rem;
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

  .hero-id {
    flex: 1 1 16rem;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .hero-name-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.625rem;
  }

  .hero-name {
    font-size: 1.875rem;
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.015em;
    color: var(--title);
    overflow-wrap: anywhere;
  }

  .hero-rank {
    width: 2.25rem;
    height: 2.25rem;
    object-fit: contain;
  }

  .hero-divider {
    width: 1px;
    height: 1.375rem;
    background: rgba(255, 255, 255, 0.14);
  }

  .accolade-icon {
    width: 1.625rem;
    height: 1.625rem;
    border-radius: 0.25rem;
    object-fit: contain;
  }

  .accolade-chip {
    display: inline-flex;
    align-items: center;
    padding: 0.125rem 0.375rem;
    border-radius: 0.375rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.8);
    font-size: 0.6875rem;
    font-weight: 700;
  }

  /*
   * Team name, tag and role sit on one line until they cannot. Without this the
   * link refuses to shrink below its content and spills past the hero on a
   * phone — "Virtuous.Proletariat [VP] captain" is wider than the column.
   */
  .identity-team {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    align-self: flex-start;
    gap: 0.5rem;
    min-width: 0;
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.88);
    text-decoration: none;
  }

  .identity-team:hover .identity-team-name {
    color: var(--accent-text);
  }

  .identity-team-name {
    font-weight: 600;
    transition: color 0.15s;
  }

  .identity-dim {
    color: rgba(255, 255, 255, 0.55);
  }

  .identity-role {
    text-transform: capitalize;
    color: rgba(255, 255, 255, 0.45);
  }

  .identity-none {
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.6);
  }

  .hero-actions {
    align-self: flex-start;
  }

  /* Owner-only forms: a tinted row of the sheet, not a box inside it. */
  .callout {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.625rem 0.875rem;
    padding: 0.75rem 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(192, 132, 252, 0.07);
  }

  .callout-text {
    flex: 1 1 17rem;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .callout-title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text);
  }

  .callout-hint {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.62);
  }

  .callout-error {
    font-size: 0.75rem;
    color: var(--bad-text);
  }

  .callout-controls {
    flex: 1 1 20rem;
    display: flex;
    gap: 0.5rem;
  }

  .callout-input {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 2.25rem;
    padding: 0 0.75rem;
    border-radius: 0.4375rem;
    border: 1px solid rgba(255, 255, 255, 0.22);
    background: rgba(0, 0, 0, 0.25);
    color: var(--text);
    font-size: 0.8125rem;
  }

  .callout-btn {
    min-height: 2.25rem;
    padding: 0 0.875rem;
    border-radius: 0.4375rem;
    border: 1px solid rgba(192, 132, 252, 0.5);
    background: rgba(192, 132, 252, 0.18);
    color: var(--text);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
  }

  .callout-btn:hover {
    background: rgba(192, 132, 252, 0.28);
  }

  /* KPI strip: cells split by hairlines along the hero's bottom edge. */
  .kpi-strip {
    display: flex;
    flex-wrap: wrap;
    border-top: 1px solid rgba(255, 255, 255, 0.09);
    background: rgba(0, 0, 0, 0.16);
  }

  .kpi {
    flex: 1 1 6.5rem;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3125rem;
    padding: 0.875rem 1.25rem;
    border-right: 1px solid rgba(255, 255, 255, 0.08);
  }

  .kpi:last-child,
  .kpi:has(+ .kpi-agents) {
    border-right: 0;
  }

  /*
   * The agent pool gets a line of its own under the KPI cells: sharing their
   * row, a long pool squeezed the numbers and threw their columns off.
   */
  .kpi-agents {
    flex: 1 1 100%;
    flex-direction: row;
    align-items: center;
    gap: 0.75rem;
    border-right: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .kpi-label,
  .filter-label {
    font-size: 0.65625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: rgba(255, 255, 255, 0.55);
  }

  .kpi-value {
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  .kpi-value-sub {
    color: rgba(255, 255, 255, 0.6);
  }

  .kpi-pair {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 0.5rem;
  }

  /* Two values share a cell, so they run a step smaller than a lone KPI. */
  .kpi-pair .kpi-value {
    font-size: 1.125rem;
  }

  .kpi-pair-side {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .kpi-pair-side + .kpi-pair-side {
    align-items: flex-end;
  }

  .kpi-pair-tag {
    font-size: 0.5625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.4);
  }

  .kpi-empty {
    margin: 0;
    padding: 1rem 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.09);
    background: rgba(0, 0, 0, 0.16);
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.55);
  }

  /*
   * Green means a win everywhere on the site, so the better side of a Main vs
   * Sub pair is marked by weight and full white instead.
   */
  .compare-better {
    color: var(--text);
    font-weight: 800;
  }

  .agents-icons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .agent-tile {
    width: 1.625rem;
    height: 1.625rem;
    border-radius: 0.3125rem;
    object-fit: contain;
    background: rgba(255, 255, 255, 0.06);
  }

  .agent-tile-text {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.14);
    font-size: 0.5625rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.75);
  }

  /* One filter bar for batch, roster role and the Main vs Sub toggle. */
  .filter-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.625rem 1rem;
    padding: 0.75rem 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.09);
  }

  .filter-item {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    max-width: 100%;
  }

  /* The shared picker, sized to this bar's 2.125rem controls. */
  @media (min-width: 641px) {
    .filter-item-batch :global(.picker-slot .select-trigger) {
      height: 2.125rem;
    }
  }

  @media (max-width: 640px) {
    .filter-item-batch {
      flex: 1 1 100%;
    }
  }

  .filter-note {
    flex: 1 1 16rem;
    font-size: 0.71875rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .toggle-btn {
    min-height: 2.125rem;
    padding: 0 0.75rem;
    border-radius: 0.4375rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.25);
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background 0.15s,
      border-color 0.15s,
      color 0.15s;
  }

  .toggle-btn:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.06);
  }

  .toggle-btn-on,
  .toggle-btn-on:hover {
    border-color: rgba(192, 132, 252, 0.5);
    background: rgba(192, 132, 252, 0.2);
    color: var(--text);
  }

  /* Segmented controls (roster filter, team history scope, map / agent). */
  .seg {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.18);
  }

  .seg-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    min-height: 1.875rem;
    padding: 0 0.6875rem;
    border: none;
    border-radius: 0.375rem;
    background: transparent;
    color: rgba(255, 255, 255, 0.68);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background 0.15s,
      color 0.15s;
  }

  .seg-btn:hover {
    color: var(--text);
  }

  .seg-on,
  .seg-on:hover {
    background: rgba(192, 132, 252, 0.2);
    color: var(--text);
  }

  .seg-count {
    font-size: 0.65625rem;
    color: rgba(255, 255, 255, 0.5);
    font-variant-numeric: tabular-nums;
  }

  /* Section header extras, pushed to the right edge. */
  .head-end {
    margin-left: auto;
  }

  .sheet-head {
    padding-bottom: 0.5rem;
  }

  .head-record {
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    color: rgba(255, 255, 255, 0.6);
  }

  .head-record-count {
    margin-left: 0.25rem;
  }

  .record-win {
    color: var(--good);
  }

  .record-loss {
    color: var(--bad);
  }

  .card-empty {
    padding: 1.5rem 1rem 2rem;
    text-align: center;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.5);
  }

  /* Breakdown tables */
  .table-box {
    padding: 0 0.875rem 0.875rem;
  }

  .table-scroll {
    overflow-x: auto;
  }

  .data-table {
    width: 100%;
    min-width: 34rem;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }

  .data-table th {
    padding: 0.4375rem 0.625rem;
    text-align: right;
    font-size: 0.65625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.55);
    white-space: nowrap;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .data-table td {
    padding: 0.4375rem 0.625rem;
    color: rgba(255, 255, 255, 0.82);
    white-space: nowrap;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .data-table tbody tr:last-child td {
    border-bottom: 0;
  }

  .data-table tbody tr:hover {
    background: var(--row-hover);
  }

  .data-table .col-left {
    text-align: left;
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .num-strong {
    font-weight: 600;
    color: var(--text);
  }

  .entry-key {
    display: inline-flex;
    align-items: center;
    gap: 0.625rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.82);
  }

  .map-thumb {
    width: 2.75rem;
    height: 1.375rem;
    border-radius: 0.25rem;
    object-fit: cover;
  }

  .record {
    margin-left: 0.375rem;
    font-size: 0.71875rem;
    color: rgba(255, 255, 255, 0.45);
  }

  /* Main / Sub pairs inside the comparison tables */
  .pair {
    display: inline-grid;
    grid-template-columns: repeat(2, minmax(2.25rem, auto));
    gap: 0.375rem;
    justify-content: end;
  }

  .pair-val {
    text-align: right;
  }

  .pair-sub {
    color: rgba(255, 255, 255, 0.55);
  }

  .pair-head th {
    padding-top: 0;
    font-size: 0.5625rem;
    color: rgba(255, 255, 255, 0.4);
  }

  /* Team history rows */
  .team-rows {
    display: flex;
    flex-direction: column;
    padding-bottom: 0.5rem;
  }

  .team-row {
    display: flex;
    align-items: center;
    /*
     * Wraps rather than overflowing: logo, name, role and season do not share
     * one line on a phone, and the season was the item pushed off the right
     * edge.
     */
    flex-wrap: wrap;
    gap: 0.375rem 0.75rem;
    min-height: 2.75rem;
    padding: 0.375rem 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    text-decoration: none;
    color: rgba(255, 255, 255, 0.82);
    transition: background 0.15s;
  }

  .team-row:hover {
    background: var(--row-hover);
  }

  .team-row:hover .team-row-name {
    color: var(--accent-text);
  }

  .team-row-name {
    /*
     * Small basis on purpose: flex wraps before it shrinks, so a generous basis
     * would push the season onto a second line while there was still room to
     * ellipsize the name instead.
     */
    flex: 1 1 4rem;
    min-width: 0;
    font-size: 0.875rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.15s;
  }

  .team-row-tag {
    margin-left: 0.375rem;
    font-size: 0.75rem;
    font-weight: 400;
    color: rgba(255, 255, 255, 0.5);
  }

  .team-row-role {
    flex-shrink: 0;
    font-size: 0.6875rem;
    text-transform: capitalize;
    color: rgba(255, 255, 255, 0.55);
  }

  .team-row-awards {
    display: inline-flex;
    flex-shrink: 0;
    gap: 0.75rem;
  }

  .team-row-award {
    display: inline-flex;
    align-items: center;
    gap: 0.3125rem;
    font-size: 0.71875rem;
    color: rgba(255, 255, 255, 0.72);
  }

  .team-row-award img {
    width: 0.9375rem;
    height: 0.9375rem;
    object-fit: contain;
  }

  .team-row-season {
    flex-shrink: 0;
    /* Stays hard right whether it shares the first line or wraps below. */
    margin-left: auto;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.55);
  }

  .team-row-left {
    color: rgba(255, 255, 255, 0.4);
  }

  /* Match history: a header row and link rows on one shared grid. */
  .match-grid {
    display: grid;
    grid-template-columns:
      1.5rem 1.5rem minmax(8rem, 1fr) 4.25rem 3.25rem 5.25rem 3.25rem 3rem
      3.5rem;
    align-items: center;
    column-gap: 0.75rem;
    padding: 0 1.5rem;
  }

  .match-head {
    padding-bottom: 0.375rem;
    font-size: 0.65625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.55);
  }

  .match-rows {
    display: flex;
    flex-direction: column;
  }

  .match-row {
    min-height: 2.75rem;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    font-size: 0.8125rem;
    text-decoration: none;
    color: rgba(255, 255, 255, 0.82);
    transition: background 0.15s;
  }

  .match-row:hover {
    background: var(--row-hover);
  }

  .match-row:hover .row-name {
    color: var(--accent-text);
  }

  .match-rows-more {
    display: block;
    width: 100%;
    min-height: 2.75rem;
    border: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    background: transparent;
    color: var(--accent-text);
    font-size: 0.78125rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  .match-rows-more:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .row-badge {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.375rem;
    height: 1.375rem;
    border-radius: 0.3125rem;
    font-size: 0.6875rem;
    font-weight: 700;
  }

  .row-win {
    background: rgba(74, 222, 128, 0.14);
    color: var(--good);
  }

  .row-loss {
    background: rgba(248, 113, 113, 0.14);
    color: var(--bad);
  }

  .row-logo {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 0.3125rem;
    object-fit: contain;
    flex-shrink: 0;
  }

  .row-logo-empty {
    display: inline-block;
    background: rgba(255, 255, 255, 0.06);
  }

  .row-name {
    min-width: 0;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.15s;
  }

  .sub-badge {
    display: inline-block;
    margin-left: 0.25rem;
    padding: 0 0.3125rem;
    border-radius: 0.25rem;
    background: rgba(251, 191, 36, 0.16);
    color: #fbbf24;
    font-size: 0.5625rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    vertical-align: middle;
  }

  .row-agents {
    display: flex;
    gap: 0.1875rem;
    min-width: 0;
    overflow: hidden;
  }

  .agent-icon {
    width: 1.375rem;
    height: 1.375rem;
    border-radius: 0.3125rem;
    object-fit: contain;
    background: rgba(255, 255, 255, 0.06);
  }

  .agent-icon-text {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.14);
    font-size: 0.5rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.75);
  }

  .row-score {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.25rem;
    font-variant-numeric: tabular-nums;
    color: rgba(255, 255, 255, 0.45);
  }

  .row-score b {
    font-weight: 400;
  }

  .row-score b.score-win {
    font-weight: 700;
    color: var(--text);
  }

  .score-sep {
    opacity: 0.6;
  }

  /* Responsive */
  @media (max-width: 720px) {
    /* Agents, KAST and HS% are the first to go when the row runs out of room. */
    .row-hide-sm {
      display: none;
    }

    .match-grid {
      grid-template-columns: 1.375rem 1.5rem minmax(0, 1fr) 2.75rem 4.75rem 2.75rem;
      column-gap: 0.5rem;
    }
  }

  @media (max-width: 640px) {
    .player-page {
      padding: 1rem 0.75rem 2rem;
    }

    .hero-top {
      padding: 1rem 0.875rem;
    }

    .hero-logo {
      width: 3.5rem;
      height: 3.5rem;
    }

    .hero-name {
      font-size: 1.375rem;
    }

    .hero-rank {
      width: 1.75rem;
      height: 1.75rem;
    }

    .accolade-icon {
      width: 1.25rem;
      height: 1.25rem;
    }

    .callout,
    .filter-bar,
    .kpi-empty {
      padding-left: 0.875rem;
      padding-right: 0.875rem;
    }

    .kpi {
      flex-basis: 30%;
      padding: 0.75rem 0.875rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .kpi-value {
      font-size: 1.125rem;
    }

    .kpi-agents {
      align-items: flex-start;
      border-bottom: 0;
    }

    .team-row,
    .match-grid {
      padding-left: 0.875rem;
      padding-right: 0.875rem;
    }

    .table-box {
      padding: 0 0.25rem 0.5rem;
    }

    /* The icon carries the award on its own; the label is for wider rows. */
    .team-row-award-label,
    .team-row-role {
      display: none;
    }
  }
</style>
