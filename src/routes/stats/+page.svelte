<script lang="ts">
  import { tick, untrack } from 'svelte'
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { Search } from 'lucide-svelte'
  import { SvelteURLSearchParams } from 'svelte/reactivity'
  import { resolve } from '$app/paths'
  import { agentIconUrl, rankIconUrlByKey } from '$lib/icons'
  import { statsRowKey, displayPlayerName } from '$lib/stats/ui'
  import { resolveBatchSection } from '$lib/stats/sections'
  import BatchPicker from '$lib/components/stats/BatchPicker.svelte'
  import ColumnsMenu from '$lib/components/stats/ColumnsMenu.svelte'
  import { parseRank, rankLabel, rankValue, rankBaseValue, rankImageKey } from '$lib/ranks/ranks'
  import AcsKastScatter, { type ScatterPoint } from '$lib/components/stats/AcsKastScatter.svelte'

  let { data }: PageProps = $props()

  const batchId = $derived(data.batchId as string | null)
  const batch = $derived(data.batch)
  const batches = $derived(data.batches ?? [])

  /**
   * Win rates are not stored — they are a ratio of columns that are. Deriving
   * them here keeps them sortable and filterable like any other stat.
   * `rounds` can be null on older imports, so fall back to won + lost.
   */
  function ratePct(won: unknown, total: unknown, ...fallbackParts: unknown[]): number | null {
    const w = Number(won)
    if (!Number.isFinite(w)) return null

    let t = Number(total)
    if (!Number.isFinite(t) || t <= 0) {
      t = fallbackParts.reduce<number>((sum, part) => {
        const v = Number(part)
        return sum + (Number.isFinite(v) ? v : 0)
      }, 0)
    }
    if (!Number.isFinite(t) || t <= 0) return null

    return (w / t) * 100
  }

  /** External events (Shitter League) get their own rating column. */
  const isExternal = $derived(Boolean(data.isExternal))

  /**
   * SLR = 0.898·KPR + 0.228·APR − 0.434·DPR + 0.5·KAST + 0.0005·ACS
   *     + 0.0005·ADR + 0.005·FKPG + 0.175, rounded to 3 dp.
   * KAST is stored as a percentage (72.5), so it is scaled to a fraction first.
   * Any missing input yields null rather than a misleadingly low rating.
   */
  function slr(row: Record<string, unknown>): number | null {
    const inputs = [row.kpr, row.apr, row.dpr, row.kast_pct, row.acs, row.adr, row.fkpg]
    if (inputs.some((v) => v === null || v === undefined || v === '')) return null
    const [kpr, apr, dpr, kastPct, acs, adr, fkpg] = inputs.map(Number)
    if (![kpr, apr, dpr, kastPct, acs, adr, fkpg].every(Number.isFinite)) return null
    const value =
      0.898 * kpr +
      0.228 * apr -
      0.434 * dpr +
      0.5 * (kastPct / 100) +
      0.0005 * acs +
      0.0005 * adr +
      0.005 * fkpg +
      0.175
    return Math.round(value * 1000) / 1000
  }

  const rows = $derived(
    (data.rows ?? []).map((row: Record<string, unknown>) => ({
      ...row,
      win_pct: ratePct(row.games_won, row.games, row.games_won, row.games_lost),
      round_win_pct: ratePct(row.rounds_won, row.rounds, row.rounds_won, row.rounds_lost),
      clutch_win_pct: ratePct(row.clutches_won, row.clutches_attempted),
      slr: isExternal ? slr(row) : null,
    }))
  )
  const viewer = $derived(
    (data.viewer ?? null) as {
      profileId: string
      displayName: string | null
      riotNames: string[]
    } | null
  )

  /** The viewer's own row: claimed by their profile, or imported under one of their Riot names. */
  function isViewerRow(r: Record<string, unknown>): boolean {
    if (!viewer) return false
    if (r.profile_id) return r.profile_id === viewer.profileId
    const name = String(r.player_name ?? '')
      .trim()
      .toLowerCase()
    return name !== '' && viewer.riotNames.includes(name)
  }

  const initialQ = $derived(String(data.initialQ ?? ''))
  const initialMinGames = $derived(Number(data.initialMinGames ?? 0) || 0)
  const initialSort = $derived(String(data.initialSort ?? 'acs'))
  const initialDir = $derived((data.initialDir ?? 'desc') as 'asc' | 'desc')
  const initialRankSort = $derived(Boolean(data.initialRankSort))
  const initialDisregardTier = $derived(Boolean(data.initialDisregardTier))

  // Seeded from the URL so the server-rendered markup already reflects the
  // active toggles; the effect below keeps them in step on later navigations.
  const seed = untrack(() => ({
    rankSort: Boolean(data.initialRankSort),
    disregardTier: Boolean(data.initialDisregardTier),
    chartOpen: Boolean(data.initialChart),
  }))

  let sortKey = $state<string>('acs')
  let sortDir = $state<'asc' | 'desc'>('desc')
  let rankSort = $state(seed.rankSort)
  let disregardTier = $state(seed.disregardTier)
  /** The ACS vs KAST chart under the table; closed unless asked for. */
  let chartOpen = $state(seed.chartOpen)

  let selectedBatchId = $state<string | null>(null)
  let search = $state('')
  let minGames = $state<number>(0)
  let findMeError = $state<string | null>(null)
  let highlightMe = $state(false)

  $effect(() => {
    search = initialQ
    minGames = Math.max(0, Math.trunc(initialMinGames))
    sortKey = initialSort
    sortDir = initialDir
    rankSort = initialRankSort
    disregardTier = initialDisregardTier
  })

  $effect(() => {
    selectedBatchId = batchId
    findMeError = null
    highlightMe = false
  })

  let urlSyncTimer: number | null = null

  function syncUrlNow() {
    if (typeof window === 'undefined') return
    const u = new URL(window.location.href)
    const params = u.searchParams

    const q = search.trim()
    if (q) params.set('q', q)
    else params.delete('q')

    const mg = Math.max(0, Math.trunc(minGames))
    if (mg > 0) params.set('minGames', String(mg))
    else params.delete('minGames')

    if (sortKey) params.set('sort', sortKey)
    else params.delete('sort')

    if (sortDir) params.set('dir', sortDir)
    else params.delete('dir')

    // Toggles survive the full navigation that changing batch performs.

    if (rankSort) params.set('rankSort', '1')
    else params.delete('rankSort')

    if (disregardTier) params.set('ignoreTier', '1')
    else params.delete('ignoreTier')

    params.delete('view')
    if (chartOpen) params.set('chart', '1')
    else params.delete('chart')

    const next = u.pathname + (params.toString() ? `?${params.toString()}` : '')
    const current = window.location.pathname + window.location.search
    if (next !== current) {
      window.history.replaceState({}, '', next)
    }
  }

  function scheduleUrlSync(delayMs = 200) {
    if (typeof window === 'undefined') return
    if (urlSyncTimer !== null) window.clearTimeout(urlSyncTimer)
    urlSyncTimer = window.setTimeout(() => {
      urlSyncTimer = null
      syncUrlNow()
    }, delayMs)
  }

  $effect(() => {
    // Keep URL in sync for shareable filter state.
    // Sort updates are handled immediately inside toggleSort.
    void search
    void minGames
    void rankSort
    void disregardTier
    void chartOpen
    scheduleUrlSync(200)
  })

  function qp(next: { batchId?: string | null }) {
    const params = new SvelteURLSearchParams()
    const nextBatch = next.batchId === undefined ? batchId : next.batchId
    if (nextBatch) params.set('batchId', nextBatch)
    const q = search.trim()
    if (q) params.set('q', q)
    const mg = Math.max(0, Math.trunc(minGames))
    if (mg > 0) params.set('minGames', String(mg))
    if (sortKey) params.set('sort', sortKey)
    if (sortDir) params.set('dir', sortDir)
    if (rankSort) params.set('rankSort', '1')
    if (disregardTier) params.set('ignoreTier', '1')
    if (chartOpen) params.set('chart', '1')

    const qs = params.toString()
    return qs ? `/stats?${qs}` : '/stats'
  }

  function unclaimedHref(playerName: string) {
    const params = new SvelteURLSearchParams()
    params.set('name', playerName)
    if (selectedBatchId) params.set('batchId', selectedBatchId)
    const qs = params.toString()
    return `${resolve('/players/unclaimed')}?${qs}`
  }

  function fmt(n: unknown, digits = 1) {
    if (n === null || n === undefined || n === '') return '—'
    const v = Number(n)
    if (!Number.isFinite(v)) return '—'
    return v.toFixed(digits)
  }

  function rankIconUrl(leagueRank: unknown): string | null {
    if (typeof leagueRank !== 'string') return null
    return rankIconUrlByKey(rankImageKey(leagueRank))
  }

  const hasAnyRanks = $derived(rows.some((r: Record<string, unknown>) => !!r.league_rank))

  function parseAgents(value: unknown): string[] {
    if (typeof value !== 'string') return []
    const tokens = value
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
    return Array.from(new Set(tokens))
  }

  const baseColumns = [
    { key: 'agents', label: 'Agents', digits: 0 },
    { key: 'games', label: 'Games', digits: 0 },
    { key: 'games_won', label: 'W', digits: 0 },
    { key: 'games_lost', label: 'L', digits: 0 },
    { key: 'win_pct', label: 'Win%', digits: 1 },
    { key: 'rounds', label: 'Rounds', digits: 0 },
    { key: 'rounds_won', label: 'RW', digits: 0 },
    { key: 'rounds_lost', label: 'RL', digits: 0 },
    { key: 'round_win_pct', label: 'RWin%', digits: 1 },
    { key: 'acs', label: 'ACS', digits: 0 },
    { key: 'kd', label: 'K/D', digits: 2 },
    { key: 'kast_pct', label: 'KAST%', digits: 1 },
    { key: 'adr', label: 'ADR', digits: 0 },
    { key: 'kills', label: 'K', digits: 0 },
    { key: 'deaths', label: 'D', digits: 0 },
    { key: 'assists', label: 'A', digits: 0 },
    { key: 'kpg', label: 'KPG', digits: 1 },
    { key: 'kpr', label: 'KPR', digits: 2 },
    { key: 'dpg', label: 'DPG', digits: 1 },
    { key: 'dpr', label: 'DPR', digits: 2 },
    { key: 'apg', label: 'APG', digits: 1 },
    { key: 'apr', label: 'APR', digits: 2 },
    { key: 'fk', label: 'FK', digits: 0 },
    { key: 'fd', label: 'FD', digits: 0 },
    { key: 'fkpg', label: 'FKPG', digits: 1 },
    { key: 'fdpg', label: 'FDPG', digits: 1 },
    { key: 'hs_pct', label: 'HS%', digits: 1 },
    { key: 'plants', label: 'Plants', digits: 0 },
    { key: 'plants_per_game', label: 'Plants/G', digits: 2 },
    { key: 'defuses', label: 'Defuses', digits: 0 },
    { key: 'defuses_per_game', label: 'Defuses/G', digits: 2 },
    // Only batches generated from Riot-imported matches carry these; every
    // CSV batch shows a dash, which is why they are off by default.
    { key: 'mk_2k', label: '2K', digits: 0 },
    { key: 'mk_3k', label: '3K', digits: 0 },
    { key: 'mk_4k', label: '4K', digits: 0 },
    { key: 'mk_5k', label: '5K', digits: 0 },
    { key: 'mk_6k', label: '6K', digits: 0 },
    { key: 'mk_7k', label: '7K', digits: 0 },
    { key: 'clutches_won', label: 'Clutch W', digits: 0 },
    { key: 'clutches_attempted', label: 'Clutch A', digits: 0 },
    { key: 'clutch_win_pct', label: 'Clutch%', digits: 1 },
  ]

  // SLR sits just before ACS, and only exists for external events.
  const allColumns = $derived.by(() => {
    if (!isExternal) return baseColumns
    const at = baseColumns.findIndex((c) => c.key === 'acs')
    return [
      ...baseColumns.slice(0, at),
      { key: 'slr', label: 'SLR', digits: 3 },
      ...baseColumns.slice(at),
    ]
  })

  // `slr` is harmless on rivals batches — it has no column there to show.
  const defaultVisible = [
    'slr',
    'agents',
    'games',
    'win_pct',
    'round_win_pct',
    'acs',
    'kd',
    'adr',
    'kast_pct',
    'hs_pct',
  ]
  let visibleColumns = $state<string[]>([...defaultVisible])

  /** Agent icons shown per row before the rest fold into "+N". */
  const MAX_AGENT_ICONS = 4

  /** A claimed player's profile name wins over the Riot name the stats were imported under. */
  function rowName(r: Record<string, unknown>): string {
    return displayPlayerName(r?.profile_name ?? r?.player_name)
  }

  function compareValues(a: Record<string, unknown>, b: Record<string, unknown>, key: string) {
    const av = a?.[key]
    const bv = b?.[key]
    if (key === 'player_name') {
      return rowName(a).localeCompare(rowName(b), undefined, { sensitivity: 'base' })
    }
    if (key === 'agents') {
      return parseAgents(av).length - parseAgents(bv).length
    }
    const an = Number(av)
    const bn = Number(bv)
    const aNumOk = Number.isFinite(an)
    const bNumOk = Number.isFinite(bn)
    if (aNumOk && bNumOk) return an - bn
    return String(av ?? '').localeCompare(String(bv ?? ''), undefined, { sensitivity: 'base' })
  }

  function toggleSort(nextKey: string) {
    if (sortKey === nextKey) {
      sortDir = sortDir === 'desc' ? 'asc' : 'desc'
      syncUrlNow()
      return
    }

    sortKey = nextKey
    sortDir = nextKey === 'player_name' ? 'asc' : 'desc'
    syncUrlNow()
  }

  const maxGames = $derived.by(() => {
    let max = 0
    for (const r of rows) {
      const g = Number(r?.games ?? 0)
      if (Number.isFinite(g)) max = Math.max(max, Math.trunc(g))
    }
    return max
  })

  $effect(() => {
    if (minGames > maxGames) minGames = maxGames
  })

  const filteredRows = $derived.by(() => {
    const q = search.trim().toLowerCase()
    const mg = Math.max(0, Math.trunc(minGames))

    return rows.filter((r: Record<string, unknown>) => {
      const nameOk = !q
        ? true
        : rowName(r).toLowerCase().includes(q) ||
          String(r.player_name ?? '')
            .toLowerCase()
            .includes(q)

      if (!nameOk) return false
      if (mg <= 0) return true
      return Number(r?.games ?? 0) >= mg
    })
  })

  const sortedRows = $derived.by(() => {
    const key = sortKey
    const dir = sortDir
    const copy = [...filteredRows]
    copy.sort((a, b) => {
      if (rankSort) {
        const valueFn = disregardTier ? rankBaseValue : rankValue
        const aRank = valueFn(a.league_rank as string)
        const bRank = valueFn(b.league_rank as string)
        if (aRank !== bRank) return bRank - aRank
      }
      const delta = compareValues(a, b, key)
      if (delta !== 0) return dir === 'asc' ? delta : -delta
      return 0
    })
    return copy
  })

  /** Find me also marks the viewer's dot on the chart, until the chart closes. */
  let graphFound = $state(false)

  $effect(() => {
    if (!chartOpen) graphFound = false
  })

  async function findMe() {
    if (!viewer?.profileId) return
    findMeError = null

    // Ensure row isn't filtered out.
    search = ''
    minGames = 0
    syncUrlNow()
    highlightMe = false
    await tick()

    const el = document.querySelector('[data-viewer-row]')
    if (!el) {
      findMeError = 'Could not find you in this batch.'
      return
    }

    graphFound = showGraphs && scatterPoints.some((p) => p.isViewer)
    highlightMe = true
    // The table scrolls in its own box; keep the page itself where it is.
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    window.setTimeout(() => (highlightMe = false), 2000)
  }

  /** Batch name and the visible player count. */
  const batchSubtitle = $derived.by(() => {
    const parts: string[] = []
    if (batch?.display_name) {
      parts.push(String(batch.display_name))
    } else if (batchId) {
      parts.push(String(batchId))
    } else {
      parts.push('No imports yet')
    }
    parts.push(
      sortedRows.length === rows.length
        ? `${rows.length} players`
        : `${sortedRows.length} of ${rows.length} players`
    )
    return parts.join(' · ')
  })

  const sortedLabel = $derived(
    sortKey === 'player_name'
      ? 'Player'
      : (allColumns.find((c) => c.key === sortKey)?.label ?? sortKey)
  )

  const footCount = $derived(
    `${sortedRows.length} of ${rows.length} players` +
      (minGames > 0 ? ` · ${Math.trunc(minGames)}+ games` : '')
  )

  const sortNote = $derived(
    (rankSort ? `By rank${disregardTier ? ' (ignoring tier)' : ''}, then sorted` : 'Sorted') +
      ` by ${sortedLabel}, ${sortDir === 'desc' ? 'high to low' : 'low to high'}`
  )

  const events = $derived((data.events ?? []) as Array<{ name: string; external: boolean }>)

  /**
   * The chart only exists for a season's Full Season tab. `chartOpen` stays as
   * picked so moving between seasons keeps it open; other phases hide the
   * section entirely.
   */
  const isFullSeason = $derived.by(() => {
    const current = batches.find((b) => b.id === batchId)
    return current ? resolveBatchSection(current) === 'full' : false
  })
  const showGraphs = $derived(isFullSeason && chartOpen)

  const scatterPoints = $derived.by((): ScatterPoint[] => {
    if (!showGraphs) return []
    return filteredRows.flatMap((r: Record<string, unknown>, index: number) => {
      // Number(null) is 0, which would plot missing stats at the origin.
      if (r.acs == null || r.kast_pct == null) return []
      const acs = Number(r.acs)
      const kast = Number(r.kast_pct)
      if (!Number.isFinite(acs) || !Number.isFinite(kast)) return []
      // A KAST of 0 means the import had no KAST, not a real score (Season 2's
      // one-game "Red/firebug" row). Plotted, it drags the axis down to 0%.
      if (kast <= 0) return []
      return [
        {
          key: statsRowKey(r, index),
          name: rowName(r),
          acs,
          kast,
          isViewer: isViewerRow(r),
          rankLabel: rankLabel(r.league_rank as string | null),
          rankTier: parseRank(r.league_rank as string | null)?.name ?? null,
        },
      ]
    })
  })

  const foundPointKey = $derived(
    graphFound ? (scatterPoints.find((p) => p.isViewer)?.key ?? null) : null
  )

  function goToBatch(id: string) {
    window.location.href = qp({ batchId: id })
  }
</script>

<svelte:head><title>Player Stats</title></svelte:head>

<PageContainer>
  <div class="stats-page">
    <header class="stats-head">
      <h1 class="stats-title">Player Stats</h1>
      <p class="stats-sub">{batchSubtitle}</p>
    </header>

    <div class="sheet">
      <!-- One control bar: which table, then filters, then what to show. -->
      <div class="toolbar">
        <BatchPicker {batches} {events} {batchId} onPick={goToBatch} />

        <div class="search-wrap">
          <span class="search-icon"><Search size={14} /></span>
          <input
            class="search-input"
            placeholder="Search players"
            aria-label="Search players"
            bind:value={search}
          />
        </div>

        <div class="min-games">
          <label class="min-games-label" for="stats-min-games">Min games</label>
          <input
            id="stats-min-games"
            type="range"
            min="0"
            max={maxGames}
            step="1"
            value={String(minGames)}
            disabled={maxGames <= 0}
            class="min-games-range"
            oninput={(e) => {
              minGames = Number((e.currentTarget as HTMLInputElement).value)
            }}
          />
          <span class="min-games-value">{Math.max(0, Math.trunc(minGames))}</span>
        </div>

        <div class="toolbar-end">
          {#if viewer?.profileId}
            <button type="button" class="tool-btn" onclick={findMe}>Find me</button>
          {/if}
          <ColumnsMenu
            columns={allColumns}
            bind:visible={visibleColumns}
            defaults={defaultVisible}
            showRankSort={hasAnyRanks}
            bind:rankSort
            bind:disregardTier
          />
        </div>
      </div>

      {#if findMeError}
        <div class="alert">{findMeError}</div>
      {/if}

      {#if sortedRows.length === 0}
        <p class="empty-text">No players match the current filters.</p>
      {:else}
        <div class="stats-table-wrap">
          <table class="stats-table">
            <thead>
              <tr>
                <th class="col-index">#</th>
                {#if hasAnyRanks}
                  <th class="col-rank">Rank</th>
                {/if}
                <th class="col-player" class:sorted={sortKey === 'player_name'}>
                  <button
                    type="button"
                    class="sort-btn"
                    onclick={() => toggleSort('player_name')}
                    title="Sort by player"
                  >
                    Player
                    <span class="sort-caret">
                      {sortKey === 'player_name' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
                {#each allColumns as col (col.key)}
                  {#if visibleColumns.includes(col.key)}
                    <th
                      class="col-stat"
                      class:col-agents={col.key === 'agents'}
                      class:sorted={sortKey === col.key}
                      aria-sort={sortKey === col.key
                        ? sortDir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined}
                    >
                      <button
                        type="button"
                        class="sort-btn"
                        onclick={() => toggleSort(col.key)}
                        title={`Sort by ${col.label}`}
                      >
                        {col.label}
                        <span class="sort-caret">
                          {sortKey === col.key ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                        </span>
                      </button>
                    </th>
                  {/if}
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each sortedRows as row, index (statsRowKey(row, index))}
                <tr
                  id={row.profile_id ? `profile-${row.profile_id}` : undefined}
                  data-viewer-row={isViewerRow(row) || undefined}
                  class:row-highlight={highlightMe && isViewerRow(row)}
                >
                  <td class="col-index tabular">{index + 1}</td>
                  {#if hasAnyRanks}
                    {@const rUrl = rankIconUrl(row.league_rank)}
                    <td class="col-rank">
                      {#if rUrl}
                        <img
                          src={rUrl}
                          alt={rankLabel(row.league_rank as string | null) ?? ''}
                          title={rankLabel(row.league_rank as string | null) ?? ''}
                          class="rank-icon"
                        />
                      {:else}
                        <span class="dash">—</span>
                      {/if}
                    </td>
                  {/if}
                  <td class="col-player" class:sorted={sortKey === 'player_name'}>
                    {#if row.profile_id}
                      <a class="player-link" href={resolve(`/players/${row.profile_id}`)}>
                        {rowName(row)}
                      </a>
                    {:else}
                      <!-- eslint-disable svelte/no-navigation-without-resolve -->
                      <!-- unclaimedHref() returns a resolve()-built URL with a query string -->
                      <a
                        class="player-link player-link-unclaimed"
                        href={unclaimedHref(String(row.player_name ?? 'Player'))}
                        title="Unclaimed player"
                      >
                        {rowName(row)}
                      </a>
                      <!-- eslint-enable svelte/no-navigation-without-resolve -->
                    {/if}
                  </td>
                  {#each allColumns as col (col.key)}
                    {#if visibleColumns.includes(col.key)}
                      <td
                        class="col-stat"
                        class:col-agents={col.key === 'agents'}
                        class:tabular={col.key !== 'agents'}
                        class:sorted={sortKey === col.key}
                      >
                        {#if col.key === 'agents'}
                          {@const agents = parseAgents(row.agents)}
                          {#if agents.length === 0}
                            <span class="dash">—</span>
                          {:else}
                            <div class="agents-icons" title={agents.join(', ')}>
                              {#each agents.slice(0, MAX_AGENT_ICONS) as agent (agent)}
                                {@const url = agentIconUrl(agent)}
                                {#if url}
                                  <img src={url} alt={agent} class="agent-icon" />
                                {:else}
                                  <span class="agent-fallback">
                                    {agent.slice(0, 3).toUpperCase()}
                                  </span>
                                {/if}
                              {/each}
                              {#if agents.length > MAX_AGENT_ICONS}
                                <span class="agent-more">+{agents.length - MAX_AGENT_ICONS}</span>
                              {/if}
                            </div>
                          {/if}
                        {:else}
                          {fmt(row[col.key], col.digits)}
                        {/if}
                      </td>
                    {/if}
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="table-foot">
          <span>{footCount}</span>
          <span>{sortNote}</span>
        </div>
      {/if}

      {#if isFullSeason}
        <section class="sheet-section" aria-labelledby="chart-title">
          <div class="sheet-head chart-head">
            <h2 class="sheet-title" id="chart-title">ACS vs KAST</h2>
            <span class="sheet-note">Same filters as the table</span>
            <button
              type="button"
              class="tool-btn chart-toggle"
              aria-expanded={chartOpen}
              aria-controls="stats-chart"
              onclick={() => (chartOpen = !chartOpen)}
            >
              {chartOpen ? 'Hide chart' : 'Show chart'}
            </button>
          </div>
          {#if showGraphs}
            <div class="sheet-body chart-body" id="stats-chart">
              {#if scatterPoints.length === 0}
                <p class="empty-text">No players with ACS and KAST match the current filters.</p>
              {:else}
                <AcsKastScatter points={scatterPoints} highlightKey={foundPointKey} />
              {/if}
            </div>
          {/if}
        </section>
      {/if}
    </div>
  </div>
</PageContainer>

<style>
  .stats-page {
    width: 100%;
    max-width: 80rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 3rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .stats-head {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .stats-title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text);
  }

  .stats-sub {
    margin: 0;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.55);
  }

  /* The sheet scrolls the table in its own box, so it must not clip the
     Columns menu that drops out of the toolbar. */
  .sheet {
    overflow: visible;
  }

  /* Toolbar */
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.625rem;
    padding: 0.875rem 1rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .toolbar-end {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
  }

  .tool-btn {
    height: 2.25rem;
    padding: 0 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.88);
    font: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
    white-space: nowrap;
  }

  .tool-btn:hover {
    border-color: rgba(255, 255, 255, 0.24);
    color: #fff;
  }

  .search-wrap {
    position: relative;
    flex: 1 1 13rem;
    max-width: 18rem;
  }

  .search-icon {
    position: absolute;
    top: 50%;
    left: 0.625rem;
    transform: translateY(-50%);
    color: rgba(255, 255, 255, 0.45);
    pointer-events: none;
    display: flex;
  }

  .search-input {
    width: 100%;
    height: 2.25rem;
    padding: 0 0.75rem 0 2rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.04);
    color: var(--text);
    font-size: 0.8125rem;
  }

  .search-input::placeholder {
    color: rgba(255, 255, 255, 0.45);
  }

  .search-input:focus {
    outline: none;
    border-color: rgba(192, 132, 252, 0.6);
  }

  .min-games {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .min-games-label {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.5);
    white-space: nowrap;
  }

  .min-games-range {
    width: 7rem;
    accent-color: #c084fc;
  }

  .min-games-value {
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.82);
    font-variant-numeric: tabular-nums;
    min-width: 1.25rem;
  }

  .alert {
    margin: 0.75rem 1rem 0;
    padding: 0.5rem 0.875rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(251, 191, 36, 0.3);
    background: rgba(251, 191, 36, 0.08);
    color: #fde68a;
    font-size: 0.8125rem;
  }

  /* Table */
  .stats-table-wrap {
    --head: #2c184c;
    max-height: min(72vh, 46rem);
    overflow: auto;
  }

  .stats-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 0.8125rem;
    text-align: left;
  }

  .stats-table th,
  .stats-table td {
    white-space: nowrap;
    padding: 0 0.625rem;
  }

  .stats-table thead th {
    position: sticky;
    top: 0;
    z-index: 5;
    height: 2.125rem;
    /* Opaque so rows do not show through while scrolling. */
    background: var(--head);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.5);
  }

  .stats-table td {
    height: 2.375rem;
    color: rgba(255, 255, 255, 0.82);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .stats-table tbody tr:last-child td {
    border-bottom: none;
  }

  .stats-table tbody tr:hover td {
    background: rgba(255, 255, 255, 0.03);
  }

  /* The sorted column: accent label, faint tint down the column. */
  .stats-table td.sorted {
    background: rgba(192, 132, 252, 0.06);
  }

  .stats-table thead th.sorted {
    color: #c084fc;
    background: #33194f;
  }

  .row-highlight td,
  .stats-table tbody tr.row-highlight:hover td {
    background: rgba(192, 132, 252, 0.14);
  }

  .sort-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    color: inherit;
    cursor: pointer;
  }

  .sort-btn:hover {
    color: rgba(255, 255, 255, 0.85);
  }

  .sorted .sort-btn:hover {
    color: #d8b4fe;
  }

  .sort-caret {
    font-size: 0.5rem;
  }

  .col-index {
    width: 2.25rem;
    color: rgba(255, 255, 255, 0.45);
  }

  .col-rank {
    width: 2.5rem;
  }

  .col-player {
    min-width: 9rem;
  }

  .col-stat {
    text-align: right;
  }

  .stats-table thead th.col-stat .sort-btn {
    justify-content: flex-end;
    width: 100%;
  }

  .stats-table .col-agents,
  .stats-table thead th.col-agents .sort-btn {
    text-align: left;
    justify-content: flex-start;
  }

  /* With every column on, the table packs tight and the Games header would
     start right against the agent icons. Pad and divide the boundary. */
  .stats-table td.col-agents,
  .stats-table thead th.col-agents {
    padding-right: 1.25rem;
    border-right: 1px solid rgba(255, 255, 255, 0.06);
  }

  .stats-table td.col-agents + td,
  .stats-table thead th.col-agents + th {
    padding-left: 1.5rem;
  }

  .player-link {
    color: rgba(255, 255, 255, 0.82);
    font-weight: 600;
    text-decoration: none;
  }

  .player-link:hover {
    color: #fff;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .player-link-unclaimed {
    color: rgba(255, 255, 255, 0.6);
    font-weight: 400;
  }

  .dash {
    color: rgba(255, 255, 255, 0.4);
  }

  .rank-icon {
    width: 1.375rem;
    height: 1.375rem;
    object-fit: contain;
    display: block;
  }

  /* Agents */
  .agents-icons {
    display: inline-flex;
    align-items: center;
    gap: 0.1875rem;
    vertical-align: middle;
  }

  /* Fixed size, never shrunk: a percentage max-width (the global img reset)
     lets the table size this column narrower than its icons. */
  .agent-icon,
  .agent-fallback,
  .agent-more {
    flex: none;
    max-width: none;
  }

  .agent-icon,
  .agent-fallback {
    width: 1.125rem;
    height: 1.125rem;
    border-radius: 0.25rem;
  }

  .agent-icon {
    object-fit: contain;
    background: rgba(255, 255, 255, 0.06);
  }

  .agent-fallback {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.15);
    font-size: 0.4375rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.7);
  }

  /* A chip the size of an icon, so the count reads as part of the agent
     group rather than as a number in the next column. */
  .agent-more {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.125rem;
    height: 1.125rem;
    padding: 0 0.25rem;
    border-radius: 0.25rem;
    background: rgba(255, 255, 255, 0.08);
    font-size: 0.625rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.6);
  }

  .table-foot {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.625rem 1rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .empty-text {
    margin: 0;
    padding: 2.5rem 1.5rem;
    text-align: center;
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .chart-head {
    padding-bottom: 1rem;
  }

  .chart-toggle {
    margin-left: auto;
    height: 1.875rem;
    font-size: 0.75rem;
  }

  /* The scatter fills its parent's height. */
  .chart-body {
    display: flex;
    flex-direction: column;
    height: 28rem;
    padding-top: 0;
  }

  @media (max-width: 640px) {
    .stats-page {
      padding: 1rem 0 2rem;
    }

    .stats-title {
      font-size: 1.375rem;
    }

    .toolbar {
      padding: 0.75rem;
      gap: 0.5rem;
    }

    .search-wrap {
      flex-basis: 100%;
      max-width: none;
    }

    .search-input,
    .tool-btn {
      height: 2.75rem;
      font-size: 0.875rem;
    }

    .min-games {
      flex: 1 1 9rem;
    }

    .min-games-range {
      flex: 1 1 0;
      min-width: 0;
      width: auto;
    }

    .stats-table-wrap {
      max-height: 70dvh;
    }

    /* The player's name stays in view while the stats scroll sideways. */
    .stats-table .col-player {
      position: sticky;
      left: 0;
      z-index: 2;
      background: var(--head);
      border-right: 1px solid rgba(255, 255, 255, 0.08);
      min-width: 7.5rem;
      max-width: 9rem;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .stats-table thead th.col-player {
      z-index: 6;
    }

    .stats-table td {
      height: 2.5rem;
    }

    .chart-toggle {
      height: 2.25rem;
    }

    .chart-body {
      height: 22rem;
    }
  }
</style>
