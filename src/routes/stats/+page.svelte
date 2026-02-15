<script lang="ts">
  import { tick } from 'svelte'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { BarChart3 } from 'lucide-svelte'

  let { data } = $props() as { data: any }

  const batchId = $derived(data.batchId as string | null)
  const batch = $derived(data.batch as any | null)
  const rows = $derived((data.rows ?? []) as any[])
  const batches = $derived((data.batches ?? []) as any[])
  const viewer = $derived(
    (data.viewer ?? null) as { profileId: string; displayName: string | null } | null
  )

  let sortKey = $state<string>('acs')
  let sortDir = $state<'asc' | 'desc'>('desc')

  let selectedBatchId = $state<string | null>(null)
  let search = $state('')
  let findMeError = $state<string | null>(null)
  let highlightedProfileId = $state<string | null>(null)

  $effect(() => {
    selectedBatchId = batchId
    findMeError = null
    highlightedProfileId = null
  })

  function qp(next: { batchId?: string | null }) {
    const params = new URLSearchParams()
    const nextBatch = next.batchId === undefined ? batchId : next.batchId
    if (nextBatch) params.set('batchId', nextBatch)
    return `/stats?${params.toString()}`
  }

  function fmt(n: unknown, digits = 1) {
    const v = Number(n)
    if (!Number.isFinite(v)) return '—'
    return v.toFixed(digits)
  }

  const agentAssetModules = import.meta.glob('$lib/assets/agents/*_icon.png', {
    eager: true,
    import: 'default',
  }) as Record<string, string>

  const agentIconMap = $derived.by(() => {
    const map = new Map<string, string>()
    const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '')

    for (const [path, url] of Object.entries(agentAssetModules)) {
      const filename = path.split('/').pop() ?? ''
      const base = filename.replace(/_icon\.png$/i, '')
      map.set(normalize(base), url)
    }
    // Common aliases
    if (map.has('harbor')) map.set('harbour', map.get('harbor')!)
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
    { key: 'rounds', label: 'Rounds', digits: 0 },
    { key: 'rounds_won', label: 'RW', digits: 0 },
    { key: 'rounds_lost', label: 'RL', digits: 0 },
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

  const defaultVisible = new Set(['agents', 'games', 'acs', 'kd', 'adr', 'kast_pct', 'hs_pct'])
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

  function compareValues(a: any, b: any, key: string) {
    const av = a?.[key]
    const bv = b?.[key]
    if (key === 'player_name') {
      return String(av ?? '').localeCompare(String(bv ?? ''), undefined, { sensitivity: 'base' })
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
      return
    }

    sortKey = nextKey
    sortDir = nextKey === 'player_name' ? 'asc' : 'desc'
  }

  const filteredRows = $derived.by(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      String(r.player_name ?? '')
        .toLowerCase()
        .includes(q)
    )
  })

  const sortedRows = $derived.by(() => {
    const key = sortKey
    const dir = sortDir
    const copy = [...filteredRows]
    copy.sort((a, b) => {
      const delta = compareValues(a, b, key)
      return dir === 'asc' ? delta : -delta
    })
    return copy
  })

  async function findMe() {
    if (!viewer?.profileId) return
    findMeError = null

    // Ensure row isn't filtered out.
    search = ''
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

  const batchOptions = $derived.by(() => {
    const opts: Array<{ label: string; value: string }> = [{ label: 'Latest', value: '' }]
    for (const b of batches) {
      const label = `${b.display_name}${b.import_kind === 'weekly' && b.week_label ? ` (${b.week_label})` : ''}`
      opts.push({ label, value: b.id })
    }
    return opts
  })
</script>

<PageContainer class="stats-page">
  <div class="stats-viewport">
    <div class="stats-shell w-full max-w-7xl">
      <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <BarChart3 size={36} style="color: var(--text);" />
          <div>
            <h1 class="responsive-title">Player Stats</h1>
            <p class="pt-2 text-sm" style="color: rgba(255,255,255,0.72);">
              {#if batch?.display_name}
                {batch.display_name}
                {#if batch.import_kind === 'weekly' && batch.week_label}
                  <span class="opacity-80"> • {batch.week_label}</span>
                {/if}
              {:else if batchId}
                {batchId}
              {:else}
                No imports yet
              {/if}
            </p>
          </div>
        </div>

        <div class="flex w-full flex-wrap items-center justify-between gap-3">
          <div class="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-start">
            <input
              type="text"
              class="w-full rounded-md border px-3 py-2 text-sm md:w-[320px]"
              style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
              placeholder="Search players"
              bind:value={search}
            />

            {#if viewer?.profileId}
              <button
                type="button"
                class="w-full rounded-md border px-3 py-2 text-sm md:w-auto"
                style="border-color: rgba(74,222,128,0.35); background: rgba(74,222,128,0.10); color: #86efac;"
                onclick={findMe}
              >
                Find me
              </button>
            {/if}
          </div>

          <div class="flex flex-wrap items-center justify-end gap-2">
            <div class="min-w-[220px]">
              <CustomSelect
                options={batchOptions}
                value={selectedBatchId ?? ''}
                compact={true}
                onSelect={(value) => (window.location.href = qp({ batchId: value || null }))}
              />
            </div>
          </div>
        </div>
      </div>

      {#if findMeError}
        <div
          class="mb-4 rounded-md border px-3 py-2 text-sm"
          style="border-color: rgba(250,204,21,0.35); background: rgba(250,204,21,0.10); color: #fde68a;"
        >
          {findMeError}
        </div>
      {/if}

      <!-- Columns: collapsible on mobile, always open on md+ -->
      <details
        class="mb-4 rounded-md border p-3 md:hidden"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.18);"
      >
        <summary class="flex cursor-pointer items-center justify-between gap-3">
          <div
            class="text-xs font-semibold tracking-wide uppercase"
            style="color: rgba(255,255,255,0.72);"
          >
            Visible Columns
            <span class="ml-2 font-normal" style="color: rgba(255,255,255,0.55);">
              ({visibleColumns.length}/{allColumns.length})
            </span>
          </div>
          <div class="text-xs font-bold" style="color: rgba(255,255,255,0.7);">+</div>
        </summary>

        <div class="mt-3">
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="rounded px-2 py-1 text-xs"
                style="background: rgba(59,130,246,0.2); color: #93c5fd;"
                onclick={setAllColumns}
              >
                Show all
              </button>
              <button
                type="button"
                class="rounded px-2 py-1 text-xs"
                style="background: rgba(255,255,255,0.10); color: rgba(255,255,255,0.85);"
                onclick={resetColumns}
              >
                Reset
              </button>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            {#each allColumns as col}
              <button
                type="button"
                class="rounded-full px-3 py-1 text-xs"
                style={visibleColumns.includes(col.key)
                  ? 'background: rgba(74,222,128,0.16); color: #86efac;'
                  : 'background: rgba(255,255,255,0.10); color: rgba(255,255,255,0.78);'}
                onclick={() => toggleColumn(col.key)}
              >
                {col.label}
              </button>
            {/each}
          </div>
        </div>
      </details>

      <div
        class="mb-4 hidden rounded-md border p-3 md:block"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.18);"
      >
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div
            class="text-xs font-semibold tracking-wide uppercase"
            style="color: rgba(255,255,255,0.72);"
          >
            Visible Columns
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="rounded px-2 py-1 text-xs"
              style="background: rgba(59,130,246,0.2); color: #93c5fd;"
              onclick={setAllColumns}>Show all</button
            >
            <button
              type="button"
              class="rounded px-2 py-1 text-xs"
              style="background: rgba(255,255,255,0.10); color: rgba(255,255,255,0.85);"
              onclick={resetColumns}>Reset</button
            >
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          {#each allColumns as col}
            <button
              type="button"
              class="rounded-full px-3 py-1 text-xs"
              style={visibleColumns.includes(col.key)
                ? 'background: rgba(74,222,128,0.16); color: #86efac;'
                : 'background: rgba(255,255,255,0.10); color: rgba(255,255,255,0.78);'}
              onclick={() => toggleColumn(col.key)}
            >
              {col.label}
            </button>
          {/each}
        </div>
      </div>

      {#if sortedRows.length === 0}
        <div
          class="inline-flex w-fit self-center rounded-md border px-3 py-2"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
        >
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">No players found.</p>
        </div>
      {:else}
        <div
          class="stats-table-wrap rounded-md border"
          style="border-color: rgba(255,255,255,0.12);"
        >
          <table class="stats-table min-w-full text-left text-sm">
            <thead>
              <tr class="text-xs tracking-wide uppercase" style="color: rgba(255,255,255,0.75);">
                <th class="px-3 py-2">
                  <button
                    type="button"
                    class="inline-flex items-center gap-1"
                    style="color: inherit;"
                    onclick={() => toggleSort('player_name')}
                    title="Sort by player"
                  >
                    Player
                    {#if sortKey === 'player_name'}
                      <span class="text-xs font-bold" style="color: #86efac;"
                        >{sortDir === 'asc' ? '^' : 'v'}</span
                      >
                    {/if}
                  </button>
                </th>
                {#each allColumns as col}
                  {#if visibleColumns.includes(col.key)}
                    <th class="px-3 py-2">
                      <button
                        type="button"
                        class="inline-flex items-center gap-1"
                        style="color: inherit;"
                        onclick={() => toggleSort(col.key)}
                        title={`Sort by ${col.label}`}
                      >
                        {col.label}
                        {#if sortKey === col.key}
                          <span class="text-xs font-bold" style="color: #86efac;"
                            >{sortDir === 'asc' ? '^' : 'v'}</span
                          >
                        {/if}
                      </button>
                    </th>
                  {/if}
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each sortedRows as row}
                <tr
                  class="border-t"
                  id={row.profile_id ? `profile-${row.profile_id}` : undefined}
                  style={`border-color: rgba(255,255,255,0.10); ${row.profile_id && row.profile_id === highlightedProfileId ? 'background: rgba(74,222,128,0.08);' : ''}`}
                >
                  <td class="px-3 py-2 font-semibold" style="color: var(--text);">
                    <div class="flex items-center gap-2">
                      {#if row.profile_id}
                        <a
                          class="min-w-0 truncate underline"
                          style="color: var(--text);"
                          href={`/players/${row.profile_id}`}
                        >
                          {row.player_name}
                        </a>
                      {:else}
                        <span class="min-w-0 truncate">{row.player_name}</span>
                      {/if}
                      <!-- Match/unmatched badge temporarily disabled -->
                      <!--
                      {#if !row.profile_id}
                        <span
                          class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                          style="background: rgba(250,204,21,0.18); color: #fde68a;"
                        >
                          unmatched
                        </span>
                      {/if}
                      -->
                    </div>
                  </td>
                  {#each allColumns as col}
                    {#if visibleColumns.includes(col.key)}
                      <td class="px-3 py-2 align-middle" style="color: rgba(255,255,255,0.82);">
                        {#if col.key === 'agents'}
                          {@const agents = parseAgents(row.agents)}
                          {#if agents.length === 0}
                            —
                          {:else}
                            <div class="agents-icons">
                              {#each agents as agent}
                                {@const url = agentIconUrl(agent)}
                                {#if url}
                                  <img
                                    src={url}
                                    alt={agent}
                                    title={agent}
                                    class="h-6 w-6 rounded-sm object-contain"
                                    style="background: rgba(0,0,0,0.15);"
                                  />
                                {:else}
                                  <span
                                    class="inline-flex h-6 w-6 items-center justify-center rounded-sm border text-[10px] font-bold"
                                    style="border-color: rgba(255,255,255,0.15); color: rgba(255,255,255,0.8);"
                                    title={agent}
                                  >
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
  :global(.page-container.stats-page) {
    padding: 0;
    justify-content: flex-start;
    align-items: stretch;
    height: calc(100svh - 4rem);
    overflow: hidden;
  }

  .stats-viewport {
    height: 100%;
    overflow: hidden;
    display: flex;
    justify-content: center;
    padding: 24px 16px;
  }

  .agents-icons {
    display: inline-grid;
    grid-template-rows: 24px;
    grid-auto-flow: column;
    grid-auto-columns: 24px;
    gap: 4px;
  }

  /* On smaller screens, allow wrapping into 2 rows to reduce horizontal sprawl. */
  @media (max-width: 768px) {
    .agents-icons {
      grid-template-rows: 24px 24px;
    }
  }

  .stats-shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .stats-table-wrap {
    flex: 1 1 auto;
    overflow: auto;
    min-height: 0;
  }

  .stats-table thead th {
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--secondary-background);
  }

  .stats-table thead th {
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.1);
  }
</style>
