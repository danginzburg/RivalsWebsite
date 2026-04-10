<script lang="ts">
  // Extracted from /add-stats to live under /admin.
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
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

  import type { PageData } from '../../../routes/admin/stats-import/$types'

  interface Props {
    data: PageData
  }

  let { data }: Props = $props()

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
  let displayName = $state('')
  let importKind = $state<'weekly' | 'aggregate'>('weekly')
  let weekLabel = $state('')
  let parseError = $state<string | null>(null)
  let isSubmitting = $state(false)
  let submitResult = $state<{ success: boolean; message: string } | null>(null)
  let isDragOver = $state(false)

  function normalizeKey(value: string): string {
    return value.trim().toLowerCase()
  }

  function normalizeBase(value: string): string {
    return value.split('#')[0]?.trim().toLowerCase()
  }

  const profileMap = $derived.by(() => {
    const map = new Map<string, string>()
    for (const p of data.profiles ?? []) {
      if (p.riot_id_base) {
        const full = normalizeKey(p.riot_id_base)
        const base = normalizeBase(p.riot_id_base)
        map.set(full, p.id)
        map.set(base, p.id)
      }
      if (p.display_name) {
        const full = normalizeKey(p.display_name)
        const base = normalizeBase(p.display_name)
        map.set(full, p.id)
        map.set(base, p.id)
      }
    }
    return map
  })

  const stats = $derived.by(() => {
    const totalPlayers = parsedRows.length
    const matchedCount = parsedRows.filter((row) => row.matched_profile_id).length
    const unmatchedCount = totalPlayers - matchedCount
    const avgACS =
      totalPlayers > 0 ? parsedRows.reduce((sum, row) => sum + (row.acs || 0), 0) / totalPlayers : 0
    const avgKD =
      totalPlayers > 0 ? parsedRows.reduce((sum, row) => sum + (row.kd || 0), 0) / totalPlayers : 0

    return {
      totalPlayers,
      matchedCount,
      unmatchedCount,
      avgACS,
      avgKD,
    }
  })

  const weekLabelSuggestions = $derived.by(() => {
    const raw = (data.weekLabels ?? []) as unknown
    if (!Array.isArray(raw)) return [] as string[]
    return raw
      .map((v) => String(v ?? '').trim())
      .filter(Boolean)
      .slice(0, 30)
  })

  function parseNumber(value: string): number {
    const n = Number(String(value ?? '').trim())
    return Number.isFinite(n) ? n : 0
  }

  function parsePercent(value: string): number {
    const raw = String(value ?? '').trim()
    if (!raw) return 0
    if (/^n\/?a$/i.test(raw)) return 0

    const hasPercent = raw.includes('%')
    const cleaned = raw.replace('%', '').trim()
    const n = parseNumber(cleaned)
    // Some exports provide KAST as 0-1 instead of 0-100.
    if (!hasPercent && n > 0 && n <= 1) return n * 100
    return n
  }

  type HeaderKey =
    | 'PLAYER'
    | 'AGENTS'
    | 'GAMES'
    | 'W'
    | 'L'
    | 'ROUNDS'
    | 'RW'
    | 'RL'
    | 'ACS'
    | 'KD'
    | 'KAST'
    | 'ADR'
    | 'K'
    | 'KPG'
    | 'KPR'
    | 'D'
    | 'DPG'
    | 'DPR'
    | 'A'
    | 'APG'
    | 'APR'
    | 'FK'
    | 'FKPG'
    | 'FD'
    | 'FDPG'
    | 'HS%'
    | 'PLANTS'
    | 'PLANTS/G'
    | 'DEFUSES'
    | 'DEFUSES/G'
    | 'ECON'

  const REQUIRED_KEYS: HeaderKey[] = [
    'PLAYER',
    'AGENTS',
    'GAMES',
    'W',
    'L',
    'ROUNDS',
    'RW',
    'RL',
    'ACS',
    'KD',
    'KAST',
    'ADR',
    'K',
    'KPG',
    'KPR',
    'D',
    'DPG',
    'DPR',
    'A',
    'APG',
    'APR',
    'FK',
    'FKPG',
    'FD',
    'FDPG',
    'HS%',
    'PLANTS',
    'PLANTS/G',
    'DEFUSES',
    'DEFUSES/G',
    'ECON',
  ]

  function normalizeHeader(raw: string): string {
    return String(raw ?? '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ')
  }

  function buildHeaderIndex(headers: string[]): Record<HeaderKey, number> {
    const indexByCanonical = new Map<string, number>()
    headers.forEach((h, idx) => indexByCanonical.set(normalizeHeader(h), idx))

    const synonyms: Record<HeaderKey, string[]> = {
      PLAYER: ['PLAYER'],
      AGENTS: ['AGENTS'],
      GAMES: ['GAMES', '# GAMES'],
      W: ['W', 'GAMES WON'],
      L: ['L', 'GAMES LOST'],
      ROUNDS: ['ROUNDS', '# ROUNDS', '# ROUNDS '],
      RW: ['RW', 'ROUNDS WON'],
      RL: ['RL', 'ROUNDS LOST'],
      ACS: ['ACS'],
      KD: ['KD', 'K/D'],
      KAST: ['KAST', 'KAST%'],
      ADR: ['ADR'],
      K: ['K', 'KILLS'],
      KPG: ['KPG'],
      KPR: ['KPR'],
      D: ['D', 'DEATHS'],
      DPG: ['DPG'],
      DPR: ['DPR'],
      A: ['A', 'ASSISTS'],
      APG: ['APG'],
      APR: ['APR'],
      FK: ['FK'],
      FKPG: ['FKPG'],
      FD: ['FD'],
      FDPG: ['FDPG'],
      'HS%': ['HS%', 'HS %'],
      PLANTS: ['PLANTS'],
      'PLANTS/G': ['PLANTS/G', 'PLANTS / GAME'],
      DEFUSES: ['DEFUSES'],
      'DEFUSES/G': ['DEFUSES/G', 'DEFUSES / GAME'],
      ECON: ['ECON', 'ECON RATING'],
    }

    const out = {} as Record<HeaderKey, number>
    for (const key of REQUIRED_KEYS) {
      const candidates = synonyms[key]
      const found = candidates
        .map((c) => indexByCanonical.get(normalizeHeader(c)))
        .find((v) => typeof v === 'number')
      if (typeof found !== 'number') {
        throw new Error(`CSV missing required column: ${key}`)
      }
      out[key] = found
    }
    return out
  }

  function parseCSV(text: string): ParsedRow[] {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
    if (lines.length < 2) throw new Error('CSV must include a header and at least one data row')

    const headers = lines[0].split(',').map((h) => h.trim())
    const idx = buildHeaderIndex(headers)

    const out: ParsedRow[] = []
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',')
      const playerName = parts[0]?.trim()
      if (!playerName) continue

      const matched_profile_id =
        profileMap.get(normalizeKey(playerName)) ??
        profileMap.get(normalizeBase(playerName)) ??
        null

      out.push({
        player_name: playerName,
        agents: parts[idx.AGENTS]?.trim() ?? '',
        games: parseNumber(parts[idx.GAMES]),
        games_won: parseNumber(parts[idx.W]),
        games_lost: parseNumber(parts[idx.L]),
        rounds: parseNumber(parts[idx.ROUNDS]),
        rounds_won: parseNumber(parts[idx.RW]),
        rounds_lost: parseNumber(parts[idx.RL]),
        acs: parseNumber(parts[idx.ACS]),
        kd: parseNumber(parts[idx.KD]),
        kast_pct: parsePercent(parts[idx.KAST]),
        adr: parseNumber(parts[idx.ADR]),
        kills: parseNumber(parts[idx.K]),
        kpg: parseNumber(parts[idx.KPG]),
        kpr: parseNumber(parts[idx.KPR]),
        deaths: parseNumber(parts[idx.D]),
        dpg: parseNumber(parts[idx.DPG]),
        dpr: parseNumber(parts[idx.DPR]),
        assists: parseNumber(parts[idx.A]),
        apg: parseNumber(parts[idx.APG]),
        apr: parseNumber(parts[idx.APR]),
        fk: parseNumber(parts[idx.FK]),
        fkpg: parseNumber(parts[idx.FKPG]),
        fd: parseNumber(parts[idx.FD]),
        fdpg: parseNumber(parts[idx.FDPG]),
        hs_pct: parsePercent(parts[idx['HS%']]),
        plants: parseNumber(parts[idx.PLANTS]),
        plants_per_game: parseNumber(parts[idx['PLANTS/G']]),
        defuses: parseNumber(parts[idx.DEFUSES]),
        defuses_per_game: parseNumber(parts[idx['DEFUSES/G']]),
        econ_rating: parseNumber(parts[idx.ECON]),
        matched_profile_id,
      })
    }
    return out
  }

  function handleFile(file: File) {
    parseError = null
    submitResult = null

    if (!file.name.toLowerCase().endsWith('.csv')) {
      parseError = 'Please upload a .csv file'
      return
    }

    fileName = file.name
    displayName = file.name

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = String(e.target?.result ?? '')
        parsedRows = parseCSV(text)
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
    const file = e.dataTransfer?.files?.[0]
    if (file) handleFile(file)
  }

  function handleFileInput(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0]
    if (file) handleFile(file)
  }

  function clearData() {
    parsedRows = []
    fileName = null
    displayName = ''
    importKind = 'weekly'
    weekLabel = ''
    parseError = null
    submitResult = null
  }

  const importKindOptions = [
    { label: 'Weekly', value: 'weekly' },
    { label: 'Aggregate', value: 'aggregate' },
  ]

  async function submitStats() {
    if (parsedRows.length === 0) return
    isSubmitting = true
    submitResult = null

    try {
      const response = await window.fetch('/api/admin/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: parsedRows,
          sourceFilename: fileName,
          displayName,
          importKind,
          weekLabel,
        }),
      })

      const result = await response.json().catch(() => ({}))

      if (!response.ok) {
        submitResult = {
          success: false,
          message: result.message || result.error || 'Failed to import stats',
        }
      } else {
        submitResult = {
          success: true,
          message: `Successfully imported ${result.imported} player stats. ${result.matched} matched to profiles, ${result.unmatched} unmatched.`,
        }
        parsedRows = []
        fileName = null
      }
    } catch (err) {
      submitResult = {
        success: false,
        message: err instanceof Error ? err.message : 'Unexpected error',
      }
    } finally {
      isSubmitting = false
    }
  }
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-6xl">
      <div class="mb-8 flex flex-col items-center">
        <Upload size={48} class="mb-4" style="color: var(--text);" />
        <h1 class="responsive-title mb-2 text-center">Stats Import</h1>
        <p class="responsive-text mb-6 text-center" style="color: var(--text);">
          Upload a weekly or aggregate stats CSV.
        </p>
      </div>

      <div
        class="rounded-lg border p-6"
        style={isDragOver
          ? 'border-color: rgba(59,130,246,0.6); background: rgba(59,130,246,0.08);'
          : 'border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);'}
        role="region"
        aria-label="CSV upload dropzone"
        ondragover={(e) => {
          e.preventDefault()
          isDragOver = true
        }}
        ondragleave={() => (isDragOver = false)}
        ondrop={handleDrop}
      >
        <div class="flex flex-col items-center text-center">
          <FileSpreadsheet size={42} class="mb-3" style="color: var(--text);" />
          <p class="text-sm" style="color: rgba(255,255,255,0.78);">
            Drag and drop a CSV, or click to select.
          </p>
          <label
            class="mt-4 cursor-pointer rounded-md px-4 py-2 text-sm font-semibold"
            style="background: rgba(59,130,246,0.2); color: #93c5fd;"
          >
            Choose File
            <input type="file" accept=".csv" class="hidden" onchange={handleFileInput} />
          </label>
        </div>
      </div>

      {#if parseError}
        <div
          class="mt-4 rounded-md border p-3 text-sm"
          style="border-color: rgba(248,113,113,0.35); background: rgba(248,113,113,0.08); color: #fecaca;"
        >
          {parseError}
        </div>
      {/if}

      {#if submitResult}
        <div
          class="mt-4 rounded-md border p-3 text-sm"
          style={submitResult.success
            ? 'border-color: rgba(34,197,94,0.30); background: rgba(34,197,94,0.08); color: #86efac;'
            : 'border-color: rgba(248,113,113,0.35); background: rgba(248,113,113,0.08); color: #fecaca;'}
        >
          {submitResult.message}
        </div>
      {/if}

      {#if parsedRows.length > 0 && stats}
        <div
          class="mt-6 mb-6 grid grid-cols-1 gap-3 rounded-lg border p-4 md:grid-cols-3"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.18);"
        >
          <div>
            <div
              class="mb-1 text-xs font-semibold tracking-wide uppercase"
              style="color: rgba(255,255,255,0.7);"
            >
              Display Name
            </div>
            <input
              class="w-full rounded-md border px-3 py-2 text-sm"
              style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
              placeholder="Week 1, Aggregate, ..."
              bind:value={displayName}
            />
          </div>
          <div>
            <div
              class="mb-1 text-xs font-semibold tracking-wide uppercase"
              style="color: rgba(255,255,255,0.7);"
            >
              Upload Type
            </div>
            <CustomSelect
              options={importKindOptions}
              value={importKind}
              compact={false}
              onSelect={(v) => (importKind = v as 'weekly' | 'aggregate')}
            />
          </div>
          <div>
            <div
              class="mb-1 text-xs font-semibold tracking-wide uppercase"
              style="color: rgba(255,255,255,0.7);"
            >
              Week Label
            </div>
            <input
              class="w-full rounded-md border px-3 py-2 text-sm"
              style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
              placeholder="Week 1"
              list="week-label-suggestions"
              bind:value={weekLabel}
              disabled={importKind !== 'weekly'}
            />
            {#if weekLabelSuggestions.length > 0}
              <datalist id="week-label-suggestions">
                {#each weekLabelSuggestions as w}
                  <option value={w}></option>
                {/each}
              </datalist>
            {/if}
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="rounded-md px-3 py-2 text-xs font-semibold"
            style="background: rgba(74,222,128,0.2); color: #4ade80;"
            onclick={submitStats}
            disabled={isSubmitting}
          >
            {#if isSubmitting}
              <Loader2 class="mr-2 inline h-4 w-4 animate-spin" />
              Importing...
            {:else}
              Import
            {/if}
          </button>

          <button
            type="button"
            class="rounded-md px-3 py-2 text-xs font-semibold"
            style="background: rgba(248,113,113,0.2); color: #f87171;"
            onclick={clearData}
          >
            <Trash2 class="mr-2 inline h-4 w-4" />
            Clear
          </button>

          <div class="ml-auto text-xs" style="color: rgba(255,255,255,0.7);">
            Rows: {stats.totalPlayers} • Matched: {stats.matchedCount} • Unmatched: {stats.unmatchedCount}
          </div>
        </div>

        <div
          class="mt-4 overflow-x-auto rounded-md border"
          style="border-color: rgba(255,255,255,0.12);"
        >
          <table class="min-w-full text-left text-sm">
            <thead>
              <tr class="text-xs tracking-wide uppercase" style="color: rgba(255,255,255,0.75);">
                <th class="px-3 py-2">Player</th>
                <th class="px-3 py-2">ACS</th>
                <th class="px-3 py-2">K/D</th>
                <th class="px-3 py-2">ADR</th>
                <th class="px-3 py-2">KAST%</th>
                <th class="px-3 py-2">Matched</th>
              </tr>
            </thead>
            <tbody>
              {#each parsedRows as row}
                <tr class="border-t" style="border-color: rgba(255,255,255,0.10);">
                  <td class="px-3 py-2 font-semibold" style="color: var(--text);"
                    >{row.player_name}</td
                  >
                  <td class="px-3 py-2" style="color: rgba(255,255,255,0.82);">{row.acs}</td>
                  <td class="px-3 py-2" style="color: rgba(255,255,255,0.82);">{row.kd}</td>
                  <td class="px-3 py-2" style="color: rgba(255,255,255,0.82);">{row.adr}</td>
                  <td class="px-3 py-2" style="color: rgba(255,255,255,0.82);">{row.kast_pct}</td>
                  <td class="px-3 py-2">
                    {#if row.matched_profile_id}
                      <span
                        class="rounded-full px-2 py-1 text-xs font-semibold"
                        style="background: rgba(74,222,128,0.18); color: #86efac;">Yes</span
                      >
                    {:else}
                      <span
                        class="rounded-full px-2 py-1 text-xs font-semibold"
                        style="background: rgba(250,204,21,0.18); color: #fde68a;">No</span
                      >
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </div>
</PageContainer>
