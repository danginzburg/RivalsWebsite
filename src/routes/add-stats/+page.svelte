<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import {
    Upload,
    FileSpreadsheet,
    CheckCircle,
    AlertTriangle,
    Loader2,
    Trash2,
    Users,
    Swords,
    Target,
    TrendingUp,
    Crosshair,
    Shield,
  } from 'lucide-svelte'

  let { data } = $props()

  type ParsedRow = {
    player_name: string
    agents: string
    games: number
    games_won: number
    games_lost: number
    rounds: number
    rounds_won: number
    rounds_lost: number
    acs: number
    kd: number
    kast_pct: number
    adr: number
    kills: number
    kpg: number
    kpr: number
    deaths: number
    dpg: number
    dpr: number
    assists: number
    apg: number
    apr: number
    fk: number
    fkpg: number
    fd: number
    fdpg: number
    hs_pct: number
    plants: number
    plants_per_game: number
    defuses: number
    defuses_per_game: number
    econ_rating: number
    matched_profile_id: string | null
  }

  let parsedRows = $state<ParsedRow[]>([])
  let fileName = $state<string | null>(null)
  let parseError = $state<string | null>(null)
  let isSubmitting = $state(false)
  let submitResult = $state<{ success: boolean; message: string } | null>(null)
  let isDragOver = $state(false)

  // Build a lookup map for profile matching (case-insensitive)
  function normalizeKey(value: string): string {
    return value.trim().toLowerCase()
  }

  function normalizeBase(value: string): string {
    return value.split('#')[0]?.trim().toLowerCase()
  }

  const profileMap = $derived.by(() => {
    const map = new Map<string, string>()
    for (const p of data.profiles ?? []) {
      if (p.display_name) {
        const full = normalizeKey(p.display_name)
        const base = normalizeBase(p.display_name)
        map.set(full, p.id)
        if (base && base !== full) {
          map.set(base, p.id)
        }
      }
      if (p.riot_id) {
        const base = normalizeBase(p.riot_id)
        if (base) {
          map.set(base, p.id)
        }
      }
    }
    return map
  })

  const matchedCount = $derived(parsedRows.filter((r) => r.matched_profile_id).length)
  const unmatchedCount = $derived(parsedRows.filter((r) => !r.matched_profile_id).length)

  // Aggregate stats for dashboard cards
  const stats = $derived.by(() => {
    if (parsedRows.length === 0) return null
    const n = parsedRows.length
    const avg = (fn: (r: ParsedRow) => number) => {
      const sum = parsedRows.reduce((acc, r) => acc + fn(r), 0)
      return sum / n
    }
    const max = (fn: (r: ParsedRow) => number) => Math.max(...parsedRows.map(fn))
    const min = (fn: (r: ParsedRow) => number) => Math.min(...parsedRows.map(fn))
    const totalGames = parsedRows.reduce((acc, r) => acc + r.games, 0)
    const totalKills = parsedRows.reduce((acc, r) => acc + r.kills, 0)
    const totalDeaths = parsedRows.reduce((acc, r) => acc + r.deaths, 0)

    return {
      playerCount: n,
      totalGames,
      totalKills,
      totalDeaths,
      avgAcs: avg((r) => r.acs),
      avgKd: avg((r) => r.kd),
      avgKast: avg((r) => r.kast_pct),
      avgAdr: avg((r) => r.adr),
      avgHsPct: avg((r) => r.hs_pct),
      avgEcon: avg((r) => r.econ_rating),
      maxAcs: max((r) => r.acs),
      minAcs: min((r) => r.acs),
      maxKd: max((r) => r.kd),
      minKd: min((r) => r.kd),
      maxKast: max((r) => r.kast_pct),
      maxAdr: max((r) => r.adr),
    }
  })

  // Precompute per-field maxima for stat bar rendering
  const maxByField = $derived.by(() => {
    if (parsedRows.length === 0) {
      return {
        acs: 0,
        kd: 0,
        kast_pct: 0,
        adr: 0,
        hs_pct: 0,
        econ_rating: 0,
      }
    }

    return {
      acs: Math.max(...parsedRows.map((r) => r.acs)),
      kd: Math.max(...parsedRows.map((r) => r.kd)),
      kast_pct: Math.max(...parsedRows.map((r) => r.kast_pct)),
      adr: Math.max(...parsedRows.map((r) => r.adr)),
      hs_pct: Math.max(...parsedRows.map((r) => r.hs_pct)),
      econ_rating: Math.max(...parsedRows.map((r) => r.econ_rating)),
    }
  })

  // Compute stat bar width as percentage relative to the max in the dataset
  function statBarPct(
    value: number,
    field: 'acs' | 'kd' | 'kast_pct' | 'adr' | 'hs_pct' | 'econ_rating'
  ): number {
    const maxVal = maxByField[field]
    if (maxVal === 0) return 0
    return (value / maxVal) * 100
  }

  // Color coding for K/D ratio
  function kdColor(kd: number): string {
    if (kd >= 1.5) return '#4ade80'
    if (kd >= 1.2) return '#86efac'
    if (kd >= 1.0) return 'rgba(255,255,255,0.9)'
    if (kd >= 0.8) return '#fde68a'
    return '#f87171'
  }

  function parseNumber(val: string): number {
    const cleaned = val.replace('%', '').trim()
    const num = Number(cleaned)
    return isNaN(num) ? 0 : num
  }

  function parseInteger(val: string): number {
    const num = parseInt(val.trim(), 10)
    return isNaN(num) ? 0 : num
  }

  function parseCsv(text: string): ParsedRow[] {
    const lines = text.trim().split('\n')
    if (lines.length < 2) {
      throw new Error('CSV must have a header row and at least one data row')
    }

    // Validate header
    const header = lines[0].split(',').map((h) => h.trim())
    if (header[0] !== 'PLAYER') {
      throw new Error(
        'Invalid CSV format. Expected first column header to be "PLAYER". Got: "' + header[0] + '"'
      )
    }

    const rows: ParsedRow[] = []
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      const cols = line.split(',').map((c) => c.trim())
      if (cols.length < 31) {
        throw new Error(`Row ${i + 1} has ${cols.length} columns, expected 31`)
      }

      const playerName = cols[0]
      const key = normalizeKey(playerName)
      const base = normalizeBase(playerName)
      const matchedId = profileMap.get(key) ?? profileMap.get(base) ?? null

      rows.push({
        player_name: playerName,
        agents: cols[1],
        games: parseInteger(cols[2]),
        games_won: parseInteger(cols[3]),
        games_lost: parseInteger(cols[4]),
        rounds: parseInteger(cols[5]),
        rounds_won: parseInteger(cols[6]),
        rounds_lost: parseInteger(cols[7]),
        acs: parseNumber(cols[8]),
        kd: parseNumber(cols[9]),
        kast_pct: parseNumber(cols[10]),
        adr: parseNumber(cols[11]),
        kills: parseInteger(cols[12]),
        kpg: parseNumber(cols[13]),
        kpr: parseNumber(cols[14]),
        deaths: parseInteger(cols[15]),
        dpg: parseNumber(cols[16]),
        dpr: parseNumber(cols[17]),
        assists: parseInteger(cols[18]),
        apg: parseNumber(cols[19]),
        apr: parseNumber(cols[20]),
        fk: parseInteger(cols[21]),
        fkpg: parseNumber(cols[22]),
        fd: parseInteger(cols[23]),
        fdpg: parseNumber(cols[24]),
        hs_pct: parseNumber(cols[25]),
        plants: parseInteger(cols[26]),
        plants_per_game: parseNumber(cols[27]),
        defuses: parseInteger(cols[28]),
        defuses_per_game: parseNumber(cols[29]),
        econ_rating: parseNumber(cols[30]),
        matched_profile_id: matchedId,
      })
    }

    return rows
  }

  function handleFile(file: File) {
    parseError = null
    submitResult = null

    if (!file.name.endsWith('.csv')) {
      parseError = 'Please upload a CSV file'
      return
    }

    fileName = file.name
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string
        parsedRows = parseCsv(text)
      } catch (err) {
        parseError = err instanceof Error ? err.message : 'Failed to parse CSV'
        parsedRows = []
      }
    }
    reader.readAsText(file)
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    isDragOver = false
    const file = e.dataTransfer?.files[0]
    if (file) handleFile(file)
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    isDragOver = true
  }

  function handleDragLeave() {
    isDragOver = false
  }

  function handleFileInput(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (file) handleFile(file)
  }

  function clearData() {
    parsedRows = []
    fileName = null
    parseError = null
    submitResult = null
  }

  async function submitStats() {
    if (parsedRows.length === 0) return

    isSubmitting = true
    submitResult = null

    try {
      const response = await fetch('/api/admin/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: parsedRows }),
      })

      const result = await response.json()

      if (!response.ok) {
        submitResult = {
          success: false,
          message: result.error || 'Failed to import stats',
        }
      } else {
        submitResult = {
          success: true,
          message: `Successfully imported ${result.imported} player stats. ${result.matched} matched to profiles, ${result.unmatched} unmatched.`,
        }
        // Clear the data after successful import
        parsedRows = []
        fileName = null
      }
    } catch {
      submitResult = {
        success: false,
        message: 'Network error. Please try again.',
      }
    } finally {
      isSubmitting = false
    }
  }
</script>

<PageContainer>
  <div class="mx-auto max-w-6xl px-4 py-8">
    <!-- Page Header -->
    <div class="mb-8">
      <h1 class="text-3xl font-bold" style="color: var(--title);">Add Stats</h1>
      <p class="mt-2 text-sm" style="color: var(--text); opacity: 0.7;">
        Import player aggregate stats from a CSV file. The data will be appended to existing stats.
      </p>
    </div>

    <!-- Upload Zone -->
    {#if parsedRows.length === 0}
      <div
        class="rounded-lg border-2 border-dashed p-12 text-center transition-colors"
        style="border-color: {isDragOver
          ? 'var(--accent)'
          : 'var(--border)'}; background-color: {isDragOver ? 'var(--hover)' : 'transparent'};"
        role="region"
        aria-label="CSV upload area"
        ondrop={handleDrop}
        ondragover={handleDragOver}
        ondragleave={handleDragLeave}
      >
        <Upload class="mx-auto mb-4 h-12 w-12" style="color: var(--text); opacity: 0.5;" />
        <p class="mb-2 text-lg font-medium" style="color: var(--text);">Drop your CSV file here</p>
        <p class="mb-4 text-sm" style="color: var(--text); opacity: 0.6;">or click to browse</p>
        <label
          class="inline-flex cursor-pointer items-center gap-2 rounded-lg px-6 py-3 font-medium transition-colors"
          style="background-color: var(--accent); color: var(--background);"
        >
          <FileSpreadsheet class="h-5 w-5" />
          <span>Choose CSV File</span>
          <input type="file" accept=".csv" class="hidden" onchange={handleFileInput} />
        </label>
      </div>
    {/if}

    <!-- Parse Error -->
    {#if parseError}
      <div
        class="mt-4 flex items-center gap-2 rounded-lg p-4"
        style="background-color: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3);"
      >
        <AlertTriangle class="h-5 w-5 shrink-0" style="color: #ef4444;" />
        <p style="color: #ef4444;">{parseError}</p>
      </div>
    {/if}

    <!-- Submit Result -->
    {#if submitResult}
      <div
        class="mt-4 flex items-center gap-2 rounded-lg p-4"
        style="background-color: {submitResult.success
          ? 'rgba(34, 197, 94, 0.1)'
          : 'rgba(239, 68, 68, 0.1)'}; border: 1px solid {submitResult.success
          ? 'rgba(34, 197, 94, 0.3)'
          : 'rgba(239, 68, 68, 0.3)'};"
      >
        {#if submitResult.success}
          <CheckCircle class="h-5 w-5 shrink-0" style="color: #22c55e;" />
          <p style="color: #22c55e;">{submitResult.message}</p>
        {:else}
          <AlertTriangle class="h-5 w-5 shrink-0" style="color: #ef4444;" />
          <p style="color: #ef4444;">{submitResult.message}</p>
        {/if}
      </div>
    {/if}

    <!-- Stats Dashboard -->
    {#if parsedRows.length > 0 && stats}
      <div class="mt-6">
        <!-- File Info + Actions Bar -->
        <div
          class="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-lg p-4"
          style="background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1);"
        >
          <div class="flex items-center gap-2">
            <FileSpreadsheet class="h-5 w-5" style="color: var(--hover);" />
            <span class="text-sm font-medium" style="color: var(--text);">
              {fileName}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80"
              style="color: var(--text); border: 1px solid rgba(255,255,255,0.15);"
              onclick={clearData}
            >
              <Trash2 class="h-4 w-4" />
              Clear
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style="background-color: var(--accent); color: var(--text);"
              disabled={isSubmitting}
              onclick={submitStats}
            >
              {#if isSubmitting}
                <Loader2 class="h-4 w-4 animate-spin" />
                Importing...
              {:else}
                <Upload class="h-4 w-4" />
                Import Stats
              {/if}
            </button>
          </div>
        </div>

        <!-- Stats Mural -->
        <div class="stats-mural mb-6">
          <div class="mural-core">
            <div class="core-eyebrow">Import Constellation</div>
            <div class="core-value">{stats.playerCount}</div>
            <div class="core-sub">players · {stats.totalGames} games</div>
            <div class="core-chips">
              <span class="chip chip-good">{matchedCount} matched</span>
              {#if unmatchedCount > 0}
                <span class="chip chip-warn">{unmatchedCount} unmatched</span>
              {/if}
            </div>
            <div class="core-micro">
              <div class="micro-row">
                <span>Avg HS%</span>
                <div class="micro-bar">
                  <div class="micro-fill" style="width: {Math.min(100, stats.avgHsPct)}%;"></div>
                </div>
                <span>{stats.avgHsPct.toFixed(1)}%</span>
              </div>
              <div class="micro-row">
                <span>Avg Econ</span>
                <div class="micro-bar">
                  <div
                    class="micro-fill econ"
                    style="width: {Math.min(100, (stats.avgEcon / 120) * 100)}%;"
                  ></div>
                </div>
                <span>{stats.avgEcon.toFixed(1)}</span>
              </div>
            </div>
          </div>

          <div class="mural-gauges">
            <div
              class="gauge"
              style="--pct: {Math.min(100, ((stats.avgAcs - 100) / 250) * 100)}%; --gauge: #60a5fa;"
            >
              <div class="gauge-icon"><TrendingUp class="h-4 w-4" /></div>
              <div class="gauge-label">Avg ACS</div>
              <div class="gauge-value">{stats.avgAcs.toFixed(0)}</div>
              <div class="gauge-sub">Peak {stats.maxAcs.toFixed(0)}</div>
            </div>
            <div
              class="gauge"
              style="--pct: {Math.min(100, (stats.avgKd / 2) * 100)}%; --gauge: #f472b6;"
            >
              <div class="gauge-icon"><Swords class="h-4 w-4" /></div>
              <div class="gauge-label">Avg K/D</div>
              <div class="gauge-value">{stats.avgKd.toFixed(2)}</div>
              <div class="gauge-sub">Peak {stats.maxKd.toFixed(2)}</div>
            </div>
            <div
              class="gauge"
              style="--pct: {Math.min(100, ((stats.avgKast - 40) / 50) * 100)}%; --gauge: #34d399;"
            >
              <div class="gauge-icon"><Target class="h-4 w-4" /></div>
              <div class="gauge-label">Avg KAST</div>
              <div class="gauge-value">{stats.avgKast.toFixed(1)}%</div>
              <div class="gauge-sub">Peak {stats.maxKast.toFixed(1)}%</div>
            </div>
            <div
              class="gauge"
              style="--pct: {Math.min(100, ((stats.avgAdr - 70) / 150) * 100)}%; --gauge: #fb923c;"
            >
              <div class="gauge-icon"><Crosshair class="h-4 w-4" /></div>
              <div class="gauge-label">Avg ADR</div>
              <div class="gauge-value">{stats.avgAdr.toFixed(0)}</div>
              <div class="gauge-sub">Peak {stats.maxAdr.toFixed(0)}</div>
            </div>
          </div>

          <div class="mural-footer">
            <div class="footer-stat">
              <Users class="h-4 w-4" />
              <span>{stats.playerCount} players</span>
            </div>
            <div class="footer-stat">
              <Shield class="h-4 w-4" />
              <span>{stats.totalKills.toLocaleString()} kills</span>
            </div>
            <div class="footer-stat muted">
              <Shield class="h-4 w-4" />
              <span>{stats.totalDeaths.toLocaleString()} deaths</span>
            </div>
          </div>
        </div>

        <!-- Enhanced Player Table -->
        <div
          class="rounded-lg"
          style="background: rgba(0,0,0,0.15); border: 1px solid rgba(255,255,255,0.08);"
        >
          <!-- Table Header -->
          <div class="px-4 py-3" style="border-bottom: 1px solid rgba(255,255,255,0.08);">
            <span
              class="text-xs font-semibold tracking-wide uppercase"
              style="color: rgba(255,255,255,0.55);"
            >
              Player Breakdown
            </span>
          </div>

          <div>
            <table class="w-full text-left text-sm">
              <thead>
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                  <th
                    class="sticky left-0 z-10 w-8 px-2 py-3"
                    style="background: rgba(0,0,0,0.3);
                  "
                  ></th>
                  <th
                    class="sticky left-8 z-10 px-3 py-3 text-xs font-semibold tracking-wide uppercase"
                    style="color: rgba(255,255,255,0.55); background: rgba(0,0,0,0.3);"
                  >
                    Player
                  </th>
                  <th
                    class="px-2 py-3 text-center text-xs font-semibold tracking-wide uppercase"
                    style="color: rgba(255,255,255,0.55);">Record</th
                  >
                  <th
                    class="px-2 py-3 text-xs font-semibold tracking-wide uppercase"
                    style="color: rgba(255,255,255,0.55);">ACS</th
                  >
                  <th
                    class="px-2 py-3 text-center text-xs font-semibold tracking-wide uppercase"
                    style="color: rgba(255,255,255,0.55);">K/D</th
                  >
                  <th
                    class="px-2 py-3 text-xs font-semibold tracking-wide uppercase"
                    style="color: rgba(255,255,255,0.55);">KAST</th
                  >
                  <th
                    class="px-2 py-3 text-xs font-semibold tracking-wide uppercase"
                    style="color: rgba(255,255,255,0.55);">ADR</th
                  >
                  <th
                    class="px-2 py-3 text-xs font-semibold tracking-wide uppercase"
                    style="color: rgba(255,255,255,0.55);">HS%</th
                  >
                </tr>
              </thead>
              <tbody>
                {#each parsedRows as row, i}
                  <tr
                    class="player-row"
                    style="border-bottom: 1px solid rgba(255,255,255,0.05); --row-bg: {i % 2 !== 0
                      ? 'rgba(255,255,255,0.02)'
                      : 'rgba(0,0,0,0.15)'};"
                  >
                    <!-- Match Status -->
                    <td class="sticky-cell sticky left-0 z-10 px-2 py-2.5">
                      {#if row.matched_profile_id}
                        <div
                          class="flex h-5 w-5 items-center justify-center rounded-full"
                          style="background: rgba(74,222,128,0.15);"
                        >
                          <CheckCircle class="h-3 w-3" style="color: #4ade80;" />
                        </div>
                      {:else}
                        <div
                          class="flex h-5 w-5 items-center justify-center rounded-full"
                          style="background: rgba(250,204,21,0.15);"
                        >
                          <AlertTriangle class="h-3 w-3" style="color: #facc15;" />
                        </div>
                      {/if}
                    </td>

                    <!-- Player Name -->
                    <td
                      class="sticky-cell sticky left-8 z-10 px-3 py-2.5 font-medium whitespace-nowrap"
                      style="color: var(--text);"
                    >
                      {row.player_name}
                    </td>

                    <!-- Win/Loss Record -->
                    <td class="px-2 py-2.5 text-center whitespace-nowrap">
                      <span class="font-medium" style="color: #4ade80;">{row.games_won}</span>
                      <span style="color: rgba(255,255,255,0.3);">-</span>
                      <span class="font-medium" style="color: #f87171;">{row.games_lost}</span>
                    </td>

                    <!-- ACS with bar -->
                    <td class="px-2 py-2.5">
                      <div class="flex items-center gap-2">
                        <span
                          class="w-10 text-right text-sm font-medium tabular-nums"
                          style="color: var(--text);">{row.acs.toFixed(0)}</span
                        >
                        <div
                          class="h-1.5 flex-1 overflow-hidden rounded-full"
                          style="background: rgba(255,255,255,0.08);"
                        >
                          <div
                            class="h-full rounded-full"
                            style="width: {statBarPct(
                              row.acs,
                              'acs'
                            )}%; background: linear-gradient(90deg, #60a5fa, #818cf8);"
                          ></div>
                        </div>
                      </div>
                    </td>

                    <!-- K/D colored -->
                    <td class="px-2 py-2.5 text-center">
                      <span class="text-sm font-bold tabular-nums" style="color: {kdColor(row.kd)};"
                        >{row.kd.toFixed(2)}</span
                      >
                    </td>

                    <!-- KAST with bar -->
                    <td class="px-2 py-2.5">
                      <div class="flex items-center gap-2">
                        <span
                          class="w-11 text-right text-sm tabular-nums"
                          style="color: var(--text);">{row.kast_pct.toFixed(1)}%</span
                        >
                        <div
                          class="h-1.5 flex-1 overflow-hidden rounded-full"
                          style="background: rgba(255,255,255,0.08);"
                        >
                          <div
                            class="h-full rounded-full"
                            style="width: {statBarPct(
                              row.kast_pct,
                              'kast_pct'
                            )}%; background: linear-gradient(90deg, #34d399, #6ee7b7);"
                          ></div>
                        </div>
                      </div>
                    </td>

                    <!-- ADR with bar -->
                    <td class="px-2 py-2.5">
                      <div class="flex items-center gap-2">
                        <span
                          class="w-10 text-right text-sm tabular-nums"
                          style="color: var(--text);">{row.adr.toFixed(0)}</span
                        >
                        <div
                          class="h-1.5 flex-1 overflow-hidden rounded-full"
                          style="background: rgba(255,255,255,0.08);"
                        >
                          <div
                            class="h-full rounded-full"
                            style="width: {statBarPct(
                              row.adr,
                              'adr'
                            )}%; background: linear-gradient(90deg, #fb923c, #fdba74);"
                          ></div>
                        </div>
                      </div>
                    </td>

                    <!-- HS% with mini bar -->
                    <td class="px-2 py-2.5">
                      <div class="flex items-center gap-2">
                        <span
                          class="w-10 text-right text-sm tabular-nums"
                          style="color: var(--text);">{row.hs_pct.toFixed(0)}%</span
                        >
                        <div
                          class="h-1.5 flex-1 overflow-hidden rounded-full"
                          style="background: rgba(255,255,255,0.08);"
                        >
                          <div
                            class="h-full rounded-full"
                            style="width: {statBarPct(
                              row.hs_pct,
                              'hs_pct'
                            )}%; background: linear-gradient(90deg, #f472b6, #f9a8d4);"
                          ></div>
                        </div>
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    {/if}
  </div>
</PageContainer>

<style>
  .stats-mural {
    display: grid;
    gap: 1rem;
    grid-template-columns: minmax(0, 1fr);
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.01));
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 1.25rem;
    padding: 1.25rem;
    position: relative;
    overflow: hidden;
    isolation: isolate;
  }

  .stats-mural::before {
    content: '';
    position: absolute;
    inset: -40% 10% auto auto;
    width: 320px;
    height: 320px;
    background: radial-gradient(circle, rgba(96, 165, 250, 0.25), transparent 65%);
    filter: blur(10px);
    opacity: 0.7;
    z-index: -1;
  }

  .stats-mural::after {
    content: '';
    position: absolute;
    inset: auto auto -50% -20%;
    width: 380px;
    height: 380px;
    background: radial-gradient(circle, rgba(52, 211, 153, 0.18), transparent 70%);
    filter: blur(20px);
    z-index: -1;
  }

  .mural-core {
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 1rem;
    padding: 1.25rem;
    display: grid;
    gap: 0.75rem;
  }

  .core-eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.2em;
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .core-value {
    font-size: clamp(2.5rem, 7vw, 3.75rem);
    font-weight: 700;
    color: var(--text);
    text-shadow: 0 8px 22px rgba(94, 52, 114, 0.4);
  }

  .core-sub {
    color: rgba(255, 255, 255, 0.65);
    font-size: 0.95rem;
  }

  .core-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .chip {
    font-size: 0.75rem;
    padding: 0.35rem 0.6rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.8);
  }

  .chip-good {
    border-color: rgba(74, 222, 128, 0.4);
    color: #86efac;
    background: rgba(74, 222, 128, 0.08);
  }

  .chip-warn {
    border-color: rgba(250, 204, 21, 0.4);
    color: #fde68a;
    background: rgba(250, 204, 21, 0.08);
  }

  .core-micro {
    display: grid;
    gap: 0.5rem;
  }

  .micro-row {
    display: grid;
    grid-template-columns: 70px 1fr 60px;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.65);
  }

  .micro-bar {
    height: 6px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 999px;
    overflow: hidden;
  }

  .micro-fill {
    height: 100%;
    background: linear-gradient(90deg, #f472b6, #f9a8d4);
    border-radius: inherit;
  }

  .micro-fill.econ {
    background: linear-gradient(90deg, #60a5fa, #818cf8);
  }

  .mural-gauges {
    display: grid;
    gap: 0.75rem;
  }

  .gauge {
    position: relative;
    padding: 1rem;
    border-radius: 0.9rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(0, 0, 0, 0.25);
    display: grid;
    gap: 0.35rem;
    overflow: hidden;
  }

  .gauge::after {
    content: '';
    position: absolute;
    inset: auto 0 0 0;
    height: 3px;
    background: linear-gradient(90deg, var(--gauge), transparent);
    opacity: 0.5;
  }

  .gauge::before {
    content: '';
    position: absolute;
    inset: auto auto 0 0;
    height: 100%;
    width: var(--pct);
    background: linear-gradient(90deg, rgba(255, 255, 255, 0.08), transparent 80%);
    opacity: 0.7;
  }

  .gauge-icon {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    color: var(--gauge);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .gauge-label {
    text-transform: uppercase;
    letter-spacing: 0.2em;
    font-size: 0.6rem;
    color: rgba(255, 255, 255, 0.55);
  }

  .gauge-value {
    font-size: 1.6rem;
    font-weight: 700;
    color: var(--text);
  }

  .gauge-sub {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.55);
  }

  .mural-footer {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1.5rem;
    padding: 0.25rem 0.5rem 0;
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.85rem;
  }

  .footer-stat {
    display: inline-flex;
    gap: 0.35rem;
    align-items: center;
  }

  .footer-stat.muted {
    color: rgba(255, 255, 255, 0.5);
  }

  .player-row {
    background: var(--row-bg);
    transition: background 150ms ease;
  }

  .player-row:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .sticky-cell {
    background: rgba(0, 0, 0, 0.2);
  }

  @media (min-width: 900px) {
    .stats-mural {
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
      grid-template-rows: auto auto;
    }

    .mural-core {
      grid-row: span 2;
    }

    .mural-gauges {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 640px) {
    .mural-footer {
      flex-direction: column;
      gap: 0.5rem;
    }
  }
</style>
