<script lang="ts">
  import { tick, untrack } from 'svelte'
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import PageHeading from '$lib/components/PageHeading.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { BarChart3, Search } from 'lucide-svelte'
  import { SvelteMap, SvelteURLSearchParams } from 'svelte/reactivity'
  import { resolve } from '$app/paths'
  import miksIcon from '$lib/assets/agents/Miks_icon.webp'
  import { statsRowKey } from '$lib/stats/ui'
  import { rankValue, rankBaseValue, rankImageKey } from '$lib/ranks/ranks'

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

  const rows = $derived(
    (data.rows ?? []).map((row: Record<string, unknown>) => ({
      ...row,
      win_pct: ratePct(row.games_won, row.games, row.games_won, row.games_lost),
      round_win_pct: ratePct(row.rounds_won, row.rounds, row.rounds_won, row.rounds_lost),
    }))
  )
  const viewer = $derived(
    (data.viewer ?? null) as { profileId: string; displayName: string | null } | null
  )

  const initialQ = $derived(String(data.initialQ ?? ''))
  const initialMinGames = $derived(Number(data.initialMinGames ?? 0) || 0)
  const initialSort = $derived(String(data.initialSort ?? 'acs'))
  const initialDir = $derived((data.initialDir ?? 'desc') as 'asc' | 'desc')
  const initialHideWeeks = $derived(Boolean(data.initialHideWeeks))
  const initialRankSort = $derived(Boolean(data.initialRankSort))
  const initialDisregardTier = $derived(Boolean(data.initialDisregardTier))

  // Seeded from the URL so the server-rendered markup already reflects the
  // active toggles; the effect below keeps them in step on later navigations.
  const seed = untrack(() => ({
    hideWeeks: Boolean(data.initialHideWeeks),
    rankSort: Boolean(data.initialRankSort),
    disregardTier: Boolean(data.initialDisregardTier),
  }))

  let sortKey = $state<string>('acs')
  let sortDir = $state<'asc' | 'desc'>('desc')
  let rankSort = $state(seed.rankSort)
  let disregardTier = $state(seed.disregardTier)
  let hideWeeks = $state(seed.hideWeeks)

  let selectedBatchId = $state<string | null>(null)
  let search = $state('')
  let minGames = $state<number>(0)
  let findMeError = $state<string | null>(null)
  let highlightedProfileId = $state<string | null>(null)

  $effect(() => {
    search = initialQ
    minGames = Math.max(0, Math.trunc(initialMinGames))
    sortKey = initialSort
    sortDir = initialDir
    hideWeeks = initialHideWeeks
    rankSort = initialRankSort
    disregardTier = initialDisregardTier
  })

  $effect(() => {
    selectedBatchId = batchId
    findMeError = null
    highlightedProfileId = null
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
    // Hiding weeks is the default, so only the off state needs recording.
    if (hideWeeks) params.delete('hideWeeks')
    else params.set('hideWeeks', '0')

    if (rankSort) params.set('rankSort', '1')
    else params.delete('rankSort')

    if (disregardTier) params.set('ignoreTier', '1')
    else params.delete('ignoreTier')

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
    void hideWeeks
    void rankSort
    void disregardTier
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
    if (!hideWeeks) params.set('hideWeeks', '0')
    if (rankSort) params.set('rankSort', '1')
    if (disregardTier) params.set('ignoreTier', '1')

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

  const rankAssetModules = import.meta.glob('$lib/assets/ranks/*_Rank.png', {
    eager: true,
    import: 'default',
  }) as Record<string, string>

  const rankIconMap = $derived.by(() => {
    const map = new SvelteMap<string, string>()
    for (const [path, url] of Object.entries(rankAssetModules)) {
      const filename = path.split('/').pop() ?? ''
      const key = filename.replace(/\.png$/i, '')
      map.set(key, url)
    }
    return map
  })

  function rankIconUrl(leagueRank: unknown): string | null {
    if (typeof leagueRank !== 'string') return null
    const key = rankImageKey(leagueRank)
    return key ? (rankIconMap.get(key) ?? null) : null
  }

  const hasAnyRanks = $derived(rows.some((r: Record<string, unknown>) => !!r.league_rank))

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
    // Common aliases
    if (map.has('harbor')) map.set('harbour', map.get('harbor')!)
    map.set('miks', miksIcon)
    return map
  })

  function agentIconUrl(agentName: string): string | null {
    const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '')
    const key = normalize(agentName)
    return agentIconMap.get(key) ?? null
  }

  function parseAgents(value: unknown): string[] {
    if (typeof value !== 'string') return []
    const tokens = value
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
    return Array.from(new Set(tokens))
  }

  const allColumns = [
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
  ]

  const defaultVisible = new Set([
    'agents',
    'games',
    'win_pct',
    'round_win_pct',
    'acs',
    'kd',
    'adr',
    'kast_pct',
    'hs_pct',
  ])
  let visibleColumns = $state<string[]>(Array.from(defaultVisible))

  $effect(() => {
    if (visibleColumns.length === 0) visibleColumns = Array.from(defaultVisible)
  })

  function toggleColumn(key: string) {
    if (visibleColumns.includes(key)) {
      visibleColumns = visibleColumns.filter((k) => k !== key)
    } else {
      visibleColumns = [...visibleColumns, key]
    }
  }

  function setAllColumns() {
    visibleColumns = allColumns.map((c) => c.key)
  }

  function resetColumns() {
    visibleColumns = Array.from(defaultVisible)
  }

  function compareValues(a: Record<string, unknown>, b: Record<string, unknown>, key: string) {
    const av = a?.[key]
    const bv = b?.[key]
    if (key === 'player_name') {
      return String(av ?? '').localeCompare(String(bv ?? ''), undefined, { sensitivity: 'base' })
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
        : String(r.player_name ?? '')
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

  async function findMe() {
    if (!viewer?.profileId) return
    findMeError = null

    // Ensure row isn't filtered out.
    search = ''
    minGames = 0
    syncUrlNow()
    highlightedProfileId = null
    await tick()

    const el = document.getElementById(`profile-${viewer.profileId}`)
    if (!el) {
      findMeError = 'Could not find you in this batch.'
      return
    }

    highlightedProfileId = viewer.profileId
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => {
      if (highlightedProfileId === viewer.profileId) highlightedProfileId = null
    }, 2000)
  }

  function isWeekBatch(b: {
    import_kind?: string | null
    week_label?: string | null
    display_name?: string | null
  }) {
    if (b.import_kind === 'weekly') return true
    if (b.week_label) return true
    if (typeof b.display_name === 'string' && /week/i.test(b.display_name)) return true
    return false
  }

  const hasAnyWeeks = $derived(batches.some((b) => isWeekBatch(b)))

  /** Batch name, week label when present, and the visible player count. */
  const batchSubtitle = $derived.by(() => {
    const parts: string[] = []
    if (batch?.display_name) {
      parts.push(String(batch.display_name))
      if (batch.import_kind === 'weekly' && batch.week_label) parts.push(String(batch.week_label))
    } else if (batchId) {
      parts.push(String(batchId))
    } else {
      parts.push('No imports yet')
    }
    parts.push(`${sortedRows.length} players`)
    return parts.join(' · ')
  })

  /**
   * On phones the heading, filters and column picker take roughly 450px of an
   * 812px screen, leaving the table about four rows tall. Collapse that block
   * once the viewer starts scrolling the table so it stretches to the full
   * screen height, and bring it back when they return to the top.
   *
   * Only the mobile stylesheet acts on this flag — on desktop there is room for
   * both, so the class is inert.
   */
  let headerCollapsed = $state(false)

  function handleTableScroll(event: Event & { currentTarget: HTMLDivElement }) {
    const top = event.currentTarget.scrollTop
    // Two thresholds rather than one: collapsing grows the table under the
    // finger, and a single boundary makes the header flicker on and off.
    if (!headerCollapsed && top > 24) headerCollapsed = true
    else if (headerCollapsed && top < 4) headerCollapsed = false
  }

  const batchOptions = $derived.by(() => {
    const opts: Array<{ label: string; value: string }> = [{ label: 'Latest', value: '' }]
    for (const b of batches) {
      // The batch actually being viewed always stays listed, otherwise the
      // select would show a blank value after landing on a week via URL.
      if (hideWeeks && isWeekBatch(b) && b.id !== selectedBatchId) continue
      const label = `${b.display_name}${b.import_kind === 'weekly' && b.week_label ? ` (${b.week_label})` : ''}`
      opts.push({ label, value: b.id })
    }
    return opts
  })
</script>

<PageContainer class="stats-page">
  <div class="stats-viewport">
    <div class="stats-shell page-content" class:shell-collapsed={headerCollapsed}>
      <div class="stats-head">
        <PageHeading title="Player Stats" subtitle={batchSubtitle} icon={BarChart3} />
      </div>

      <!-- Filters -->
      <div class="toolbar">
        <div class="search-wrap">
          <span class="search-icon"><Search size={14} /></span>
          <input class="search-input" placeholder="Search players..." bind:value={search} />
        </div>

        <div class="min-games">
          <span class="min-games-label">Min games</span>
          <input
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

        <div class="chip-group">
          {#if viewer?.profileId}
            <button type="button" class="chip chip-find" onclick={findMe}>Find me</button>
          {/if}
          {#if hasAnyRanks}
            <button
              type="button"
              class="chip"
              class:chip-on={rankSort}
              onclick={() => (rankSort = !rankSort)}
            >
              Rank sort
            </button>
            {#if rankSort}
              <button
                type="button"
                class="chip"
                class:chip-on={disregardTier}
                onclick={() => (disregardTier = !disregardTier)}
              >
                Ignore tier
              </button>
            {/if}
          {/if}
        </div>

        <!-- Batch picker sits on the same row as the search, but pushed to the
             far right: it navigates, so it should not read as another filter. -->
        <div class="batch-picker">
          {#if hasAnyWeeks}
            <button
              type="button"
              class="chip"
              class:chip-on={hideWeeks}
              onclick={() => (hideWeeks = !hideWeeks)}
            >
              Hide weeks
            </button>
          {/if}
          <div class="batch-select">
            <CustomSelect
              options={batchOptions}
              value={selectedBatchId ?? ''}
              compact={true}
              onSelect={(value) => (window.location.href = qp({ batchId: value || null }))}
            />
          </div>
        </div>
      </div>

      {#if findMeError}
        <div class="alert">{findMeError}</div>
      {/if}

      <!-- Column picker: one collapsible panel at every size. -->
      <details class="columns" open>
        <summary class="columns-summary">
          <span class="columns-chevron">▶</span>
          <span class="columns-title">Visible columns</span>
          <span class="columns-count">{visibleColumns.length}/{allColumns.length}</span>
          <span class="columns-actions">
            <button
              type="button"
              class="mini-btn"
              onclick={(e) => {
                e.preventDefault()
                setAllColumns()
              }}
            >
              Show all
            </button>
            <button
              type="button"
              class="mini-btn"
              onclick={(e) => {
                e.preventDefault()
                resetColumns()
              }}
            >
              Reset
            </button>
          </span>
        </summary>

        <div class="columns-list">
          {#each allColumns as col (col.key)}
            <button
              type="button"
              class="chip chip-sm"
              class:chip-on={visibleColumns.includes(col.key)}
              onclick={() => toggleColumn(col.key)}
            >
              {col.label}
            </button>
          {/each}
        </div>
      </details>

      {#if sortedRows.length === 0}
        <div class="empty-state">
          <BarChart3 size={36} style="color: rgba(255,255,255,0.48);" />
          <p class="empty-text">No players match the current filters.</p>
        </div>
      {:else}
        <div class="stats-table-wrap" onscroll={handleTableScroll}>
          <table class="stats-table">
            <thead>
              <tr>
                <th class="col-index">#</th>
                {#if hasAnyRanks}
                  <th class="col-rank">Rank</th>
                {/if}
                <th class="col-player">
                  <button
                    type="button"
                    class="sort-btn"
                    class:sort-active={sortKey === 'player_name'}
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
                    <th class="col-stat">
                      <button
                        type="button"
                        class="sort-btn"
                        class:sort-active={sortKey === col.key}
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
                  class:row-highlight={row.profile_id && row.profile_id === highlightedProfileId}
                >
                  <td class="col-index tabular">{index + 1}</td>
                  {#if hasAnyRanks}
                    {@const rUrl = rankIconUrl(row.league_rank)}
                    <td class="col-rank">
                      {#if rUrl}
                        <img
                          src={rUrl}
                          alt={String(row.league_rank ?? '')}
                          title={String(row.league_rank ?? '')}
                          class="rank-icon"
                        />
                      {:else}
                        <span class="dash">—</span>
                      {/if}
                    </td>
                  {/if}
                  <td class="col-player">
                    {#if row.profile_id}
                      <a class="player-link" href={resolve(`/players/${row.profile_id}`)}>
                        {row.player_name}
                      </a>
                    {:else}
                      <!-- eslint-disable svelte/no-navigation-without-resolve -->
                      <!-- unclaimedHref() returns a resolve()-built URL with a query string -->
                      <a
                        class="player-link player-link-unclaimed"
                        href={unclaimedHref(String(row.player_name ?? 'Player'))}
                        title="Unclaimed player"
                      >
                        {row.player_name}
                      </a>
                      <!-- eslint-enable svelte/no-navigation-without-resolve -->
                    {/if}
                  </td>
                  {#each allColumns as col (col.key)}
                    {#if visibleColumns.includes(col.key)}
                      <td class="col-stat" class:tabular={col.key !== 'agents'}>
                        {#if col.key === 'agents'}
                          {@const agents = parseAgents(row.agents)}
                          {#if agents.length === 0}
                            <span class="dash">—</span>
                          {:else}
                            <div class="agents-icons">
                              {#each agents as agent (agent)}
                                {@const url = agentIconUrl(agent)}
                                {#if url}
                                  <img src={url} alt={agent} title={agent} class="agent-icon" />
                                {:else}
                                  <span class="agent-fallback" title={agent}>
                                    {agent.slice(0, 3).toUpperCase()}
                                  </span>
                                {/if}
                              {/each}
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
      {/if}
    </div>
  </div>
</PageContainer>

<style>
  /*
   * The table owns the remaining viewport height and scrolls internally, so
   * the sticky header stays visible while paging through players.
   * `--surface` is the flattened equivalent of the panel tint over the page
   * background — the sticky header needs an opaque colour that matches the
   * rows exactly, which an rgba overlay cannot provide.
   */
  :global(.page-container.stats-page) {
    padding: 0;
    justify-content: flex-start;
    align-items: stretch;
    min-height: calc(100svh - 4rem);
    height: auto;
    overflow: visible;
  }

  .stats-viewport {
    --surface: #2e1a4d;
    width: 100%;
    height: calc(100svh - 4rem);
    overflow: hidden;
    display: flex;
    justify-content: center;
    padding: 1.5rem 1rem;
  }

  .stats-shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  /*
   * Header — PageHeading provides the title block. Its own `mb-5` would stack
   * on top of this wrapper's margin, so the wrapper owns the gap outright.
   */
  .stats-head {
    margin-bottom: 0.875rem;
    flex-shrink: 0;
  }

  .stats-head :global(.page-header) {
    margin-bottom: 0;
  }

  /* Pushed hard right: the picker navigates, so it is not one more filter. */
  .batch-picker {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex-shrink: 0;
    margin-left: auto;
  }

  .batch-select {
    min-width: 12rem;
  }

  /* Toolbar */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    flex-wrap: wrap;
    margin-bottom: 0.625rem;
  }

  .search-wrap {
    position: relative;
    flex: 1;
    min-width: 11rem;
    max-width: 18rem;
  }

  .search-icon {
    position: absolute;
    top: 50%;
    left: 0.625rem;
    transform: translateY(-50%);
    color: rgba(255, 255, 255, 0.52);
    pointer-events: none;
    display: flex;
  }

  .search-input {
    width: 100%;
    padding: 0.4375rem 0.75rem 0.4375rem 2rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.25);
    color: var(--text);
    font-size: 0.8125rem;
  }

  .search-input::placeholder {
    color: rgba(255, 255, 255, 0.54);
  }

  .search-input:focus {
    outline: none;
    border-color: var(--hover);
  }

  .min-games {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3125rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.25);
    min-width: 13rem;
    flex: 1;
    max-width: 16rem;
  }

  .min-games-label {
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.64);
    white-space: nowrap;
  }

  .min-games-range {
    flex: 1;
    min-width: 0;
    accent-color: var(--hover);
  }

  .min-games-value {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text);
    font-variant-numeric: tabular-nums;
    min-width: 1.5rem;
    text-align: right;
  }

  /* Chips */
  .chip-group {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex-wrap: wrap;
  }

  .chip {
    padding: 0.4375rem 0.75rem;
    border-radius: 0.4375rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.25);
    color: rgba(255, 255, 255, 0.62);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background 0.15s,
      border-color 0.15s,
      color 0.15s;
  }

  .chip:hover {
    color: var(--text);
    border-color: rgba(255, 255, 255, 0.45);
  }

  .chip-on {
    background: var(--accent);
    border-color: var(--hover);
    color: var(--text);
  }

  .chip-on:hover {
    background: var(--hover);
  }

  .chip-sm {
    padding: 0.25rem 0.5625rem;
    font-size: 0.6875rem;
    font-weight: 500;
  }

  .chip-find {
    border-color: rgba(74, 222, 128, 0.3);
    background: rgba(74, 222, 128, 0.1);
    color: #86efac;
  }

  .chip-find:hover {
    background: rgba(74, 222, 128, 0.18);
    color: #bbf7d0;
  }

  .alert {
    padding: 0.5rem 0.875rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(251, 191, 36, 0.3);
    background: rgba(251, 191, 36, 0.08);
    color: #fde68a;
    font-size: 0.8125rem;
    margin-bottom: 0.625rem;
  }

  /* Column picker */
  .columns {
    border-radius: 0.625rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.2);
    margin-bottom: 0.625rem;
    flex-shrink: 0;
  }

  .columns-summary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 0.875rem;
    cursor: pointer;
    list-style: none;
  }

  .columns-summary::-webkit-details-marker {
    display: none;
  }

  .columns-chevron {
    font-size: 0.5625rem;
    color: rgba(255, 255, 255, 0.6);
    transition: transform 0.15s;
  }

  .columns[open] .columns-chevron {
    transform: rotate(90deg);
  }

  .columns-title {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: rgba(255, 255, 255, 0.64);
  }

  .columns-count {
    font-size: 0.625rem;
    font-weight: 700;
    padding: 0.0625rem 0.375rem;
    border-radius: 9999px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.55);
    font-variant-numeric: tabular-nums;
  }

  .columns-actions {
    margin-left: auto;
    display: flex;
    gap: 0.375rem;
  }

  .mini-btn {
    padding: 0.1875rem 0.5rem;
    border-radius: 0.3125rem;
    border: none;
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.6875rem;
    font-weight: 600;
    cursor: pointer;
  }

  .mini-btn:hover {
    background: rgba(255, 255, 255, 0.13);
    color: var(--text);
  }

  .columns-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    padding: 0 0.875rem 0.875rem;
  }

  /* Table */
  .stats-table-wrap {
    flex: 1 1 0;
    overflow: auto;
    min-height: 0;
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: var(--surface);
  }

  .stats-table {
    width: 100%;
    min-width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
    text-align: left;
  }

  .stats-table th,
  .stats-table td {
    white-space: nowrap;
    padding: 0.5rem 0.75rem;
  }

  .stats-table thead th {
    position: sticky;
    top: 0;
    z-index: 5;
    /* Opaque so rows do not show through while scrolling. */
    background: var(--surface);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: rgba(255, 255, 255, 0.62);
  }

  .stats-table tbody tr {
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .stats-table tbody tr:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .stats-table tbody tr:last-child {
    border-bottom: none;
  }

  .stats-table td {
    color: rgba(255, 255, 255, 0.8);
  }

  .row-highlight {
    background: rgba(74, 222, 128, 0.1);
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

  .sort-active {
    color: #86efac;
  }

  .sort-caret {
    font-size: 0.5rem;
    min-width: 0.5rem;
  }

  .col-index {
    width: 3rem;
    color: rgba(255, 255, 255, 0.6);
  }

  .col-rank {
    width: 3.5rem;
  }

  .col-player {
    min-width: 10rem;
  }

  .col-stat {
    text-align: right;
  }

  .stats-table thead th.col-stat {
    text-align: right;
  }

  .stats-table thead th.col-stat .sort-btn {
    justify-content: flex-end;
    width: 100%;
  }

  .player-link {
    color: var(--text);
    font-weight: 600;
    text-decoration: none;
  }

  .player-link:hover {
    color: var(--accent-text);
  }

  .player-link-unclaimed {
    color: rgba(255, 255, 255, 0.62);
    font-weight: 500;
    font-style: italic;
  }

  .dash {
    color: rgba(255, 255, 255, 0.48);
  }

  .rank-icon {
    width: 1.375rem;
    height: 1.375rem;
    object-fit: contain;
  }

  /* Agents */
  .agents-icons {
    display: inline-grid;
    grid-template-rows: 1.375rem;
    grid-auto-flow: column;
    grid-auto-columns: 1.375rem;
    gap: 0.1875rem;
  }

  .agent-icon {
    width: 1.375rem;
    height: 1.375rem;
    border-radius: 0.1875rem;
    object-fit: contain;
    background: rgba(0, 0, 0, 0.2);
  }

  .agent-fallback {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.375rem;
    height: 1.375rem;
    border-radius: 0.1875rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    font-size: 0.5rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.75);
  }

  /* Empty */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    text-align: center;
    padding: 3rem 1.5rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.18);
  }

  .empty-text {
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.5);
  }

  @media (max-width: 768px) {
    /* Two rows of agent icons keeps the column from sprawling sideways. */
    .agents-icons {
      grid-template-rows: 1.375rem 1.375rem;
    }
  }

  @media (max-width: 640px) {
    .stats-viewport {
      /* `dvh` rather than `svh`: when the browser chrome retracts the table
         should take the space it frees up, not leave a strip of background. */
      height: calc(100dvh - 4rem);
      padding: 1rem 0.75rem;
    }

    .stats-head {
      gap: 0.625rem;
    }

    /*
     * Scrolled state: the heading, filters and column picker fold away so the
     * table owns the whole screen. They stay in the DOM — removing them would
     * drop the search box's focus and the picker's open/closed state.
     */
    .shell-collapsed .stats-head,
    .shell-collapsed .toolbar,
    .shell-collapsed .columns {
      max-height: 0;
      margin-bottom: 0;
      opacity: 0;
      overflow: hidden;
      pointer-events: none;
      /* The column picker's border survives a zero max-height otherwise. */
      border-width: 0;
    }

    .stats-head,
    .toolbar,
    .columns {
      max-height: 60vh;
      transition:
        max-height 0.2s ease,
        opacity 0.15s ease,
        margin-bottom 0.2s ease;
    }

    /* No room to sit beside the filters — take the full row instead. */
    .batch-picker {
      width: 100%;
      min-width: 0;
      margin-left: 0;
    }

    .batch-select {
      flex: 1;
      min-width: 0;
    }

    .search-wrap,
    .min-games {
      max-width: none;
    }
  }
</style>
