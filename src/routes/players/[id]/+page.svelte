<script lang="ts">
  import type { PageProps } from './$types'
  import { formatLeftDay } from '$lib/players/roster-dates'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
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
  const batchOptions = $derived(
    (data.stats?.batchOptions ?? []) as Array<{
      label: string
      value: string
      import_kind?: string | null
    }>
  )
  const matchHistory = $derived((data.matchHistory ?? []) as any[])
  const teamHistory = $derived(data.teamHistory ?? [])
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
  let compareRoster = $state(false)
  const rosterCompare = $derived.by(() => {
    if (!compareRoster || !canFilterRoster || !rosterTotals) return null
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

  const selectedBatchLabel = $derived.by(() => {
    if (!selected) return null
    return selected.batch?.display_name ?? selected.import_batch_id ?? null
  })
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
  heading: string,
  label: string,
  rows: BreakdownRow[],
  mainRows: BreakdownRow[],
  subRows: BreakdownRow[],
  withIcon: boolean
)}
  {@const mainByKey = new Map(mainRows.map((r) => [r.key, r]))}
  {@const subByKey = new Map(subRows.map((r) => [r.key, r]))}
  <section class="card">
    <header class="card-head">
      <h2 class="card-title">{heading}</h2>
      <span class="card-note-inline">
        Main vs Sub{mapStatsScope ? ` · scoped to ${mapStatsScope}` : ' · all recorded maps'}.
      </span>
    </header>
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
                <span class="entry-key">
                  {#if withIcon && agentIconUrl(entry.key)}
                    <img src={agentIconUrl(entry.key) ?? ''} alt="" class="agent-icon" />
                  {/if}
                  {entry.key}
                </span>
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
  </section>
{/snippet}

{#snippet breakdownTable(heading: string, label: string, rows: BreakdownRow[], withIcon: boolean)}
  <section class="card">
    <header class="card-head">
      <h2 class="card-title">{heading}</h2>
      <span class="card-note-inline">
        {#if mapStatsScope}
          Scoped to {mapStatsScope}.
        {:else}
          All recorded maps — the batch selector above does not apply.
        {/if}
      </span>
    </header>
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
                  <span class="entry-key">
                    {#if withIcon && agentIconUrl(entry.key)}
                      <img src={agentIconUrl(entry.key) ?? ''} alt="" class="agent-icon" />
                    {/if}
                    {entry.key}
                  </span>
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
  </section>
{/snippet}

<PageContainer>
  <div class="player-page">
    <div class="min-w-0">
      <div class="hero">
        <div class="flex items-start gap-4">
          {#if activeTeam?.logo_url}
            <img src={activeTeam.logo_url} alt="{activeTeam.name} logo" class="hero-logo" />
          {:else}
            <div class="hero-logo hero-logo-empty">
              <User size={34} />
            </div>
          {/if}
          <div class="min-w-0">
            <div class="flex flex-wrap items-end gap-2">
              <h1 class="hero-name">{player.riot_id}</h1>
              {#if playerRank}
                {@const rUrl = rankIconUrl(playerRank)}
                {#if rUrl}
                  <img
                    src={rUrl}
                    alt="All-time peak: {playerRank}"
                    title="All-time peak: {playerRank}"
                    class="h-8 w-8 object-contain sm:h-10 sm:w-10"
                  />
                {/if}
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
                    class="accolade-icon h-5 w-5 rounded object-contain sm:h-7 sm:w-7 md:h-9 md:w-9"
                  />
                {:else}
                  <span
                    class="accolade-icon inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold sm:text-xs"
                    style="border-color: rgba(255,255,255,0.15); background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.8);"
                    title={tooltip}
                  >
                    {accolade.name}
                  </span>
                {/if}
              {/each}
            </div>
            <div class="identity-row">
              {#if activeTeam}
                <a
                  href={resolve(`/teams/${activeTeam.id}`)}
                  class="identity-team inline-flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-white/5"
                  style="color: var(--text);"
                >
                  <span class="font-medium" style="color: rgba(255,255,255,0.88);"
                    >{activeTeam.name}</span
                  >
                  {#if activeTeam.tag}
                    <span class="text-sm" style="color: rgba(255,255,255,0.62);"
                      >[{String(activeTeam.tag).toUpperCase()}]</span
                    >
                  {/if}
                  {#if activeTeam.role}
                    <span
                      class="identity-role text-sm capitalize"
                      style="color: rgba(255,255,255,0.52);">{activeTeam.role}</span
                    >
                  {/if}
                </a>
              {:else}
                <span class="text-sm" style="color: rgba(255,255,255,0.72);">No active team</span>
              {/if}
            </div>
          </div>
        </div>
      </div>

      <section class="card">
        <div class="card-body">
          <RiotAccountsPanel
            accounts={data.riotAccounts ?? []}
            canEdit={viewer.canEditRiotIdBase}
            displayName={player.display_name}
            discordHandle={player.discord_handle}
          />

          {#if viewer.canEditRiotIdBase && !player.riot_id_base}
            <div
              class="mb-4 rounded-md border p-3"
              style="border-color: rgba(59,130,246,0.25); background: rgba(59,130,246,0.10);"
            >
              <div class="mb-1 text-sm font-semibold" style="color: rgba(255,255,255,0.92);">
                Link Your Stats
              </div>
              <div class="text-xs" style="color: rgba(255,255,255,0.72);">
                Enter your Riot name (base only, no #tag). Admin stat imports match on this.
              </div>

              <form class="mt-3 flex flex-col gap-2 md:flex-row" method="POST" use:enhance>
                <input
                  name="riot_id_base"
                  bind:value={riotIdBaseValue}
                  class="w-full flex-1 rounded-md border px-3 py-2 text-sm"
                  style="border-color: rgba(255,255,255,0.45); background: rgba(0,0,0,0.25); color: var(--text);"
                  placeholder="Example: Ginzburg"
                  autocomplete="off"
                />
                <button
                  type="submit"
                  formaction="?/setRiotIdBase"
                  class="rounded-md px-3 py-2 text-sm font-semibold"
                  style="background: rgba(74,222,128,0.2); color: #4ade80;"
                >
                  Save
                </button>
              </form>

              {#if form?.success === false}
                <div
                  class="mt-2 rounded-md border p-2 text-sm"
                  style="border-color: rgba(248,113,113,0.35); background: rgba(248,113,113,0.08); color: #fecaca;"
                >
                  {form.message ?? 'Failed to save'}
                </div>
              {/if}
            </div>
          {/if}

          {#if viewer.canEditRiotIdBase && player.has_unmatched_stats_candidate}
            <div
              class="mb-4 rounded-md border p-3"
              style="border-color: rgba(168,85,247,0.25); background: rgba(168,85,247,0.10);"
            >
              <div class="mb-1 text-sm font-semibold" style="color: rgba(255,255,255,0.92);">
                Alternate Stats Name
              </div>
              <div class="text-xs" style="color: rgba(255,255,255,0.72);">
                Use this when imported stats still list an old Riot or display name. This will also
                try to relink past imported stats.
              </div>

              <form class="mt-3 flex flex-col gap-2 md:flex-row" method="POST" use:enhance>
                <input
                  name="stats_player_name"
                  bind:value={statsPlayerNameValue}
                  class="w-full flex-1 rounded-md border px-3 py-2 text-sm"
                  style="border-color: rgba(255,255,255,0.45); background: rgba(0,0,0,0.25); color: var(--text);"
                  placeholder="Example: OldName"
                  autocomplete="off"
                />
                <button
                  type="submit"
                  formaction="?/setStatsPlayerName"
                  class="rounded-md px-3 py-2 text-sm font-semibold"
                  style="background: rgba(168,85,247,0.2); color: #d8b4fe;"
                >
                  Save Alt Name
                </button>
              </form>
            </div>
          {/if}

          <div class="stats-bar">
            <span class="section-label">Stats</span>
            {#if selectedBatchLabel}
              <span class="stats-batch">{selectedBatchLabel}</span>
            {/if}
            <div class="stats-controls">
              {#if canFilterRoster && rosterTotals}
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
              {#if batchOptions.length > 0}
                <div class="batch-select">
                  <CustomSelect
                    options={batchOptions}
                    value={selectedBatchId ?? ''}
                    compact={true}
                    onSelect={navToBatch}
                  />
                </div>
              {/if}
            </div>
          </div>

          {#if rosterCompare}
            <!-- Same tiles as the overall row, each holding a Main / Sub pair
                 like the comparison tables below. -->
            <div class="kpi-row kpi-row-compare">
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
            <p class="compare-note">
              From recorded matches{mapStatsScope ? ` in ${mapStatsScope}` : ''}, not the
              leaderboard batch.
            </p>
          {:else if !selected}
            <p class="muted">No imported stats found for this player.</p>
          {:else}
            <div class="kpi-row">
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
                <span class="kpi-value">{fmt(selected.hs_pct, 0)}</span>
              </div>
            </div>
          {/if}

          {#if !rosterCompare && selected}
            {#if parseAgents(selected.agents).length > 0}
              <div class="agent-pool">
                <span class="section-label">Agents</span>
                <div class="agents-icons">
                  {#each parseAgents(selected.agents) as agent (agent)}
                    {@const url = agentIconUrl(agent)}
                    {#if url}
                      <img src={url} alt={agent} title={agent} class="agent-tile" />
                    {:else}
                      <span class="agent-tile agent-tile-text" title={agent}>
                        {agent.slice(0, 3).toUpperCase()}
                      </span>
                    {/if}
                  {/each}
                </div>
              </div>
            {/if}
          {/if}
        </div>
      </section>

      <section class="card">
        <header class="card-head">
          <h2 class="card-title">Team History</h2>
          {#if activeSeasonId && teamHistory.length > 0}
            <div class="seg card-seg" role="group" aria-label="Team history scope">
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
          {:else if teamHistory.length > 0}
            <span class="card-count">{teamHistory.length}</span>
          {/if}
        </header>

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
                      <span class="team-row-award award-champion" title="Season champions">
                        <img src={builtInAccoladeIcons.trophy} alt="" />
                        <span class="team-row-award-label">Champions</span>
                      </span>
                    {:else if entry.placement === 'runner_up'}
                      <span class="team-row-award award-runner-up" title="Season runner-up">
                        <img src={builtInAccoladeIcons.silver_medal} alt="" />
                        <span class="team-row-award-label">Runner-up</span>
                      </span>
                    {:else if entry.placement === 'third'}
                      <span class="team-row-award award-third" title="Season 3rd place">
                        <img src={builtInAccoladeIcons.bronze_medal} alt="" />
                        <span class="team-row-award-label">3rd</span>
                      </span>
                    {/if}
                    {#if entry.is_mvp}
                      <span class="team-row-award award-mvp" title="Season MVP">
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

      {#if canFilterRoster}
        <div class="roster-filter">
          <span class="section-label">Roster</span>
          <div class="seg" role="group" aria-label="Filter stats by roster role">
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
          <span class="roster-note">
            {#if rosterCompare}
              Filters Match History. Turn off Main vs Sub to filter Map &amp; Agent stats.
            {:else}
              Filters Map, Agent &amp; Match History. Use Main vs Sub above to compare side by side.
            {/if}
          </span>
        </div>
      {/if}

      {#if mapStats.length > 0}
        {#if rosterCompare}
          {@render compareTable('Map Stats', 'Map', mapStats, mapStatsMain, mapStatsSub, false)}
        {:else}
          {@render breakdownTable('Map Stats', 'Map', shownMapStats, false)}
        {/if}
      {/if}

      {#if agentStats.length > 0}
        {#if rosterCompare}
          {@render compareTable(
            'Agent Stats',
            'Agent',
            agentStats,
            agentStatsMain,
            agentStatsSub,
            true
          )}
        {:else}
          {@render breakdownTable('Agent Stats', 'Agent', shownAgentStats, true)}
        {/if}
      {/if}

      <section class="card">
        <header class="card-head">
          <h2 class="card-title">Match History</h2>
          {#if mapStatsScope}
            <span class="card-note-inline">Scoped to {mapStatsScope}.</span>
          {/if}
          {#if shownMatchHistory.length > 0}
            <span class="card-record" title="Wins – losses">
              <b class="record-win">{matchRecord.wins}W</b>
              <span class="score-sep">–</span>
              <b class="record-loss">{matchRecord.losses}L</b>
            </span>
            <span class="card-count">{shownMatchHistory.length}</span>
          {/if}
        </header>

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
          <div class="match-rows">
            {#each visibleMatchHistory as entry (entry.match.id)}
              {@const match = entry.match}
              {@const opp = entry.opponent}
              {@const score = entry.score}
              {@const won = score.us > score.them}
              <a href={resolve(`/matches/${match.id}`)} class="match-row">
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

                <span class="row-agents">
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

                <span class="row-stat" title="Average combat score">
                  <b>{fmt(entry.acs, 0)}</b> ACS
                </span>
                <span class="row-stat row-kda">
                  {entry.kills ?? 0}/{entry.deaths ?? 0}/{entry.assists ?? 0}
                </span>
                <span class="row-stat row-hide-sm"><b>{fmt(entry.kast_pct, 0)}%</b> KAST</span>
                <span class="row-stat row-hide-sm"><b>{fmt(entry.hs_pct, 0)}%</b> HS</span>

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
      >
        {#snippet headerAction()}
          <ReviewFlagButton
            entityType="player"
            entityId={player.profile_id}
            viewerId={data.viewer?.profileId ?? null}
            noun="profile"
          />
        {/snippet}
      </CommentThread>
    </div>
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

  .player-page > div {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* Identity */
  .hero {
    padding: 1.5rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.09);
    background: linear-gradient(135deg, rgba(120, 67, 145, 0.14), rgba(0, 0, 0, 0.25));
  }

  .hero-logo {
    width: 5rem;
    height: 5rem;
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

  .hero-name {
    font-size: 1.875rem;
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.015em;
    color: var(--title);
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
    align-items: baseline;
    gap: 0.625rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }

  .card-title {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--title);
    flex-shrink: 0;
  }

  .card-note-inline {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.45);
  }

  .card-seg {
    margin-left: auto;
    align-self: center;
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

  .card-record {
    margin-left: auto;
    font-size: 0.6875rem;
    font-variant-numeric: tabular-nums;
  }

  .card-record + .card-count {
    margin-left: 0;
  }

  .record-win {
    color: #4ade80;
  }

  .record-loss {
    color: #f87171;
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

  .muted {
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.55);
  }

  .section-label {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.55);
  }

  /* Stats controls */
  .stats-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.625rem;
    margin-bottom: 0.875rem;
  }

  .stats-batch {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.6);
  }

  .stats-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
  }

  .batch-select {
    min-width: 16rem;
  }

  .toggle-btn {
    padding: 0.4375rem 0.75rem;
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

  .toggle-btn-on {
    border-color: rgba(120, 67, 145, 0.6);
    background: var(--accent);
    color: var(--text);
  }

  /* Roster (All / Main / Sub) filter bar */
  .roster-filter {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.625rem;
  }

  /* Main vs Sub comparison (replaces the KPI tiles when toggled) */
  .compare-better {
    color: #4ade80;
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
    color: rgba(255, 255, 255, 0.6);
  }

  .pair-val.compare-better {
    color: #4ade80;
  }

  .pair-head th {
    padding-top: 0;
    font-size: 0.5625rem;
    color: rgba(255, 255, 255, 0.4);
  }

  .compare-note {
    margin-top: 0.375rem;
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.45);
  }

  .seg {
    display: inline-flex;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.25);
    overflow: hidden;
  }

  .seg-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.75rem;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.65);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background 0.15s,
      color 0.15s;
  }

  .seg-btn + .seg-btn {
    border-left: 1px solid rgba(255, 255, 255, 0.1);
  }

  .seg-btn:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.06);
  }

  .seg-on {
    background: var(--accent);
    color: var(--text);
  }

  .seg-count {
    font-size: 0.625rem;
    font-weight: 700;
    padding: 0 0.3125rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.8);
    font-variant-numeric: tabular-nums;
  }

  .roster-note {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.45);
  }

  /* KPI tiles */
  .kpi-row {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.625rem;
  }

  /* Six tiles (adds Win%); the breakpoints below still reflow it to 3 / 2. */
  .kpi-row-compare {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }

  .kpi-pair {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 0.5rem;
  }

  /* Two values share a tile, so they run a step smaller than a lone KPI. */
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

  .kpi {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.75rem 0.875rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(255, 255, 255, 0.02);
  }

  .kpi-label {
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.5);
  }

  .kpi-value {
    font-size: 1.375rem;
    font-weight: 700;
    line-height: 1;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  .kpi-value-sub {
    color: rgba(255, 255, 255, 0.6);
  }

  .kpi-value.compare-better {
    color: #4ade80;
  }

  .agent-pool {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 1rem;
    padding-top: 0.875rem;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
  }

  .agent-tile {
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 0.3125rem;
    object-fit: contain;
    background: rgba(0, 0, 0, 0.2);
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

  /* Breakdown tables */
  .table-scroll {
    overflow-x: auto;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }

  .data-table th {
    padding: 0.5rem 0.75rem;
    text-align: right;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.5);
    white-space: nowrap;
  }

  .data-table td {
    padding: 0.5rem 0.75rem;
    color: rgba(255, 255, 255, 0.8);
    white-space: nowrap;
  }

  .data-table tbody tr {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .data-table tbody tr:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .data-table .col-left {
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

  .entry-key {
    display: inline-flex;
    align-items: center;
    gap: 0.4375rem;
    font-weight: 600;
    color: var(--text);
  }

  .record {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.45);
  }

  /* Match history rows — same shape as the team page. */
  .match-rows {
    display: flex;
    flex-direction: column;
  }

  .match-rows-more {
    display: block;
    width: 100%;
    padding: 0.625rem 1rem;
    border: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(255, 255, 255, 0.02);
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
  }

  .match-rows-more:hover {
    color: var(--accent-text);
    background: rgba(255, 255, 255, 0.04);
  }

  .match-row {
    display: flex;
    align-items: center;
    gap: 0.6875rem;
    padding: 0.625rem 1rem;
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
    min-width: 6rem;
    font-size: 0.875rem;
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
    border: 1px solid rgba(251, 191, 36, 0.35);
    font-size: 0.5625rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    vertical-align: middle;
  }

  /* Team history — same row rhythm as the match list above it. */
  .team-rows {
    display: flex;
    flex-direction: column;
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
    gap: 0.6875rem;
    padding: 0.625rem 1rem;
    text-decoration: none;
    color: var(--text);
    transition: background 0.15s;
  }

  .team-row + .team-row {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .team-row:hover {
    background: rgba(255, 255, 255, 0.04);
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
    font-weight: 700;
    color: rgba(255, 255, 255, 0.45);
  }

  .team-row-role {
    flex-shrink: 0;
    padding: 0.0625rem 0.375rem;
    border-radius: 0.25rem;
    background: rgba(255, 255, 255, 0.08);
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: rgba(255, 255, 255, 0.7);
  }

  .team-row-awards {
    display: inline-flex;
    flex-shrink: 0;
    gap: 0.375rem;
  }

  .team-row-award {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.0625rem 0.4375rem 0.0625rem 0.25rem;
    border: 1px solid;
    border-radius: 999px;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .team-row-award img {
    width: 1rem;
    height: 1rem;
    object-fit: contain;
  }

  .award-champion {
    border-color: rgba(250, 204, 21, 0.4);
    background: rgba(250, 204, 21, 0.1);
    color: #fde68a;
  }

  .award-runner-up {
    border-color: rgba(203, 213, 225, 0.35);
    background: rgba(203, 213, 225, 0.08);
    color: #e2e8f0;
  }

  .award-third {
    border-color: rgba(217, 119, 6, 0.45);
    background: rgba(217, 119, 6, 0.1);
    color: #fdba74;
  }

  .award-mvp {
    border-color: rgba(168, 85, 247, 0.4);
    background: rgba(168, 85, 247, 0.1);
    color: #e9d5ff;
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

  .row-agents {
    display: flex;
    gap: 0.1875rem;
    flex-shrink: 0;
  }

  .agent-icon {
    width: 1.375rem;
    height: 1.375rem;
    border-radius: 0.25rem;
    object-fit: contain;
    background: rgba(0, 0, 0, 0.2);
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

  .row-stat {
    flex-shrink: 0;
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.45);
    font-variant-numeric: tabular-nums;
  }

  .row-stat b {
    font-weight: 700;
    color: rgba(255, 255, 255, 0.82);
  }

  .row-kda {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.7);
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

  .agents-icons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  /* Team identity and contact chips on one line, wrapping when narrow. */
  .identity-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.5rem;
  }

  /*
   * Team name, tag and role sit on one line until they cannot. Without this the
   * chip refuses to shrink below its content and spills past the hero on a
   * phone — "Virtuous.Proletariat [VP] player" is wider than the column.
   */
  .identity-team {
    min-width: 0;
    flex-wrap: wrap;
  }

  /* Short and centred so it separates without crowding the text above. */
  /* Responsive */
  @media (max-width: 900px) {
    .kpi-row {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .stats-controls {
      margin-left: 0;
      width: 100%;
    }

    .batch-select {
      flex: 1;
      min-width: 0;
    }

    /* KAST and HS% are the first to go when the row runs out of room. */
    .row-hide-sm {
      display: none;
    }
  }

  @media (max-width: 640px) {
    .player-page {
      padding: 1rem 0.75rem 2rem;
    }

    .hero {
      padding: 1rem;
    }

    .hero-logo {
      width: 3.5rem;
      height: 3.5rem;
    }

    .hero-name {
      font-size: 1.375rem;
    }

    .kpi-row {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .kpi-value {
      font-size: 1.125rem;
    }

    .row-agents,
    .row-stat {
      display: none;
    }

    .row-kda {
      display: inline;
    }

    /*
     * The role reads as filler next to the team name. Dropping it is what
     * lets the header and each history row stay on one line.
     */
    .identity-role,
    .team-row-role {
      display: none;
    }

    /* The icon carries the award on its own; the label is for wider rows. */
    .team-row-award {
      padding: 0.125rem;
    }

    .team-row-award-label {
      display: none;
    }
  }
</style>
