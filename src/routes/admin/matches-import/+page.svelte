<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { Swords, Upload, Loader2, AlertTriangle, CheckCircle2, Layers3 } from 'lucide-svelte'

  let { data } = $props() as { data: any }

  type ParsedPlayerRow = {
    player_name: string
    agents: string
    acs: number
    kills: number
    deaths: number
    assists: number
    kd: number
    adr: number
    kast_pct: number
    fk: number
    fd: number
    hs_pct: number
    plants: number
    defuses: number
    econ_rating: number
    profile_id: string | null
    side: 'a' | 'b'
  }

  type ParsedMap = {
    sourceFilename: string
    teamAName: string
    teamBName: string
    scheduledAt: string
    mapName: string
    teamARounds: number
    teamBRounds: number
    playerRows: ParsedPlayerRow[]
  }

  let fileName = $state('')
  let displayName = $state('')
  let seriesMaps = $state<ParsedMap[]>([])
  let parseError = $state<string | null>(null)
  let submitMessage = $state<string | null>(null)
  let isSubmitting = $state(false)

  function normalizeKey(value: unknown) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
  }

  function normalizeBase(value: unknown) {
    return normalizeKey(String(value ?? '').split('#')[0] ?? '')
  }

  const profileMap = $derived.by(() => {
    const map = new Map<string, string>()
    for (const profile of data.profiles ?? []) {
      if (profile.riot_id_base) {
        map.set(normalizeKey(profile.riot_id_base), profile.id)
        map.set(normalizeBase(profile.riot_id_base), profile.id)
      }
      if (profile.display_name) {
        map.set(normalizeKey(profile.display_name), profile.id)
        map.set(normalizeBase(profile.display_name), profile.id)
      }
      if (profile.stats_player_name) {
        map.set(normalizeKey(profile.stats_player_name), profile.id)
        map.set(normalizeBase(profile.stats_player_name), profile.id)
      }
    }
    return map
  })

  const teamNameMap = $derived.by(() => {
    const map = new Map<string, string>()
    for (const team of data.teams ?? []) {
      map.set(normalizeKey(team.name), team.id)
    }
    return map
  })

  const seriesSummary = $derived.by(() => {
    const first = seriesMaps[0] ?? null
    const matchedPlayers = seriesMaps
      .flatMap((map) => map.playerRows)
      .filter((row) => row.profile_id).length
    const totalPlayers = seriesMaps.flatMap((map) => map.playerRows).length
    const seriesWinsA = seriesMaps.filter((map) => map.teamARounds > map.teamBRounds).length
    const seriesWinsB = seriesMaps.filter((map) => map.teamBRounds > map.teamARounds).length
    return {
      first,
      mapCount: seriesMaps.length,
      totalPlayers,
      matchedPlayers,
      unmatchedPlayers: totalPlayers - matchedPlayers,
      teamsMatched:
        first && teamNameMap.get(normalizeKey(first.teamAName))
          ? 1
          : 0 + (first && teamNameMap.get(normalizeKey(first.teamBName)) ? 1 : 0),
      seriesWinsA,
      seriesWinsB,
    }
  })

  function parseNumber(value: string) {
    const n = Number(
      String(value ?? '')
        .replace('%', '')
        .trim()
    )
    return Number.isFinite(n) ? n : 0
  }

  function parseCsv(fileName: string, text: string): ParsedMap {
    const lines = text.split(/\r?\n/)
    const meaningful = lines.map((line) => line.trim()).filter(Boolean)
    if (meaningful.length < 3)
      throw new Error(`${fileName}: CSV must include headers, players, and summary rows`)

    const header = lines[0].split(',').map((part) => part.trim().toUpperCase())
    const required = [
      'AGENT',
      'PLAYER',
      'AVG COMBAT SCORE',
      'K',
      'D',
      'A',
      'K/D',
      'ADR',
      'KAST',
      'FK',
      'FD',
      'HS%',
      'PLANTS',
      'DEFUSES',
      'ECON RATING',
    ]
    for (const column of required) {
      if (!header.includes(column))
        throw new Error(`${fileName}: missing required column ${column}`)
    }

    const playerLines: string[] = []
    let footerLine = ''
    for (let i = 1; i < lines.length; i++) {
      const rawLine = lines[i]
      const parts = rawLine.split(',').map((part) => part.trim())
      const hasAnyValue = parts.some((part) => part.length > 0)
      if (!hasAnyValue) continue
      if (parts[2] && !Number.isFinite(Number(parts[2]))) {
        footerLine = rawLine
        break
      }
      playerLines.push(rawLine)
    }

    if (playerLines.length === 0 || !footerLine)
      throw new Error(`${fileName}: could not find player rows and footer row`)

    const footer = footerLine.split(',').map((part) => part.trim())
    const teamAName = footer[0] ?? ''
    const teamBName = footer[1] ?? ''
    const scheduledAt = footer[2] ?? ''
    const teamARounds = parseNumber(footer[3])
    const teamBRounds = parseNumber(footer[5])
    const mapName = footer[7] ?? ''
    const half = Math.ceil(playerLines.length / 2)

    const playerRows = playerLines.map((line, index) => {
      const parts = line.split(',').map((part) => part.trim())
      const playerName = parts[1] ?? ''
      return {
        player_name: playerName,
        agents: parts[0] ?? '',
        acs: parseNumber(parts[2]),
        kills: parseNumber(parts[3]),
        deaths: parseNumber(parts[4]),
        assists: parseNumber(parts[5]),
        kd: parseNumber(parts[6]),
        adr: parseNumber(parts[7]),
        kast_pct: parseNumber(parts[8]),
        fk: parseNumber(parts[9]),
        fd: parseNumber(parts[10]),
        hs_pct: parseNumber(parts[12]),
        plants: parseNumber(parts[13]),
        defuses: parseNumber(parts[14]),
        econ_rating: parseNumber(parts[15]),
        profile_id:
          profileMap.get(normalizeKey(playerName)) ??
          profileMap.get(normalizeBase(playerName)) ??
          null,
        side: index < half ? 'a' : 'b',
      } satisfies ParsedPlayerRow
    })

    return {
      sourceFilename: fileName,
      teamAName,
      teamBName,
      scheduledAt,
      mapName,
      teamARounds,
      teamBRounds,
      playerRows,
    }
  }

  async function handleFiles(files: FileList) {
    parseError = null
    submitMessage = null
    const fileArray = Array.from(files)
    if (fileArray.length === 0) return
    fileName = fileArray.length === 1 ? fileArray[0].name : `${fileArray.length} map files`
    if (!displayName.trim())
      displayName = fileArray.length === 1 ? fileArray[0].name : 'Series Import'

    try {
      const parsed = await Promise.all(
        fileArray.map(async (file) => parseCsv(file.name, await file.text()))
      )

      const first = parsed[0]
      for (const [index, map] of parsed.entries()) {
        if (
          normalizeKey(map.teamAName) !== normalizeKey(first.teamAName) ||
          normalizeKey(map.teamBName) !== normalizeKey(first.teamBName)
        ) {
          throw new Error(`Map ${index + 1} teams do not match the first uploaded map`)
        }
        if (normalizeKey(map.scheduledAt) !== normalizeKey(first.scheduledAt)) {
          throw new Error(`Map ${index + 1} date does not match the first uploaded map`)
        }
      }

      seriesMaps = parsed
    } catch (err) {
      parseError = err instanceof Error ? err.message : 'Failed to parse match CSVs'
      seriesMaps = []
    }
  }

  async function submitImport() {
    isSubmitting = true
    submitMessage = null
    try {
      const response = await window.fetch('/api/admin/matches/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          bestOf: seriesMaps.length >= 5 ? 5 : 3,
          maps: seriesMaps,
        }),
      })

      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message ?? 'Failed to import series CSVs')

      submitMessage = result.unresolvedPlayers?.length
        ? `Imported ${result.mapIds?.length ?? seriesMaps.length} maps. Unmatched players: ${result.unresolvedPlayers.join(', ')}`
        : `Imported ${result.mapIds?.length ?? seriesMaps.length} maps successfully.`
      seriesMaps = []
      fileName = ''
      displayName = ''
    } catch (err) {
      submitMessage = err instanceof Error ? err.message : 'Failed to import series CSVs'
    } finally {
      isSubmitting = false
    }
  }
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-6xl space-y-6">
      <div class="flex items-center gap-3">
        <Swords size={34} style="color: var(--text);" />
        <div>
          <h1 class="responsive-title">Match Import</h1>
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">
            Upload all maps from a BO3/BO5 series together.
          </p>
          <p class="text-xs" style="color: rgba(255,255,255,0.6);">
            The importer creates or reuses one match, stores one `match_maps` row per CSV, and
            derives the series score from the map wins.
          </p>
        </div>
      </div>

      <section
        class="rounded-lg border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <label
          class="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-4 py-6 text-sm font-semibold"
          style="border-color: rgba(255,255,255,0.18); color: var(--text);"
        >
          <Upload size={16} />
          <span>{fileName || 'Choose one or more map CSVs'}</span>
          <input
            type="file"
            accept=".csv"
            multiple
            class="hidden"
            onchange={(event) => {
              const files = (event.currentTarget as HTMLInputElement).files
              if (files) handleFiles(files)
            }}
          />
        </label>

        <label class="mt-3 block text-sm" style="color: var(--text);">
          <div class="mb-1 text-xs font-semibold uppercase" style="color: rgba(255,255,255,0.72);">
            Display Name
          </div>
          <input
            bind:value={displayName}
            class="w-full rounded-md border px-3 py-2"
            style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
            placeholder="Series Import"
          />
        </label>

        {#if parseError}
          <div
            class="mt-3 rounded-md border p-3 text-sm"
            style="border-color: rgba(248,113,113,0.35); background: rgba(248,113,113,0.08); color: #fecaca;"
          >
            {parseError}
          </div>
        {/if}
        {#if submitMessage}
          <div
            class="mt-3 rounded-md border p-3 text-sm"
            style="border-color: rgba(255,255,255,0.12); background: rgba(255,255,255,0.06); color: var(--text);"
          >
            {submitMessage}
          </div>
        {/if}
      </section>

      <section class="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div
          class="rounded-lg border p-4"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
        >
          <div class="flex items-center gap-2 text-sm font-semibold">
            <Layers3 size={16} /> Maps
          </div>
          <div class="mt-2 text-3xl font-bold" style="color: var(--title);">
            {seriesSummary.mapCount}
          </div>
        </div>
        <div
          class="rounded-lg border p-4"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
        >
          <div class="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 size={16} /> Matched Players
          </div>
          <div class="mt-2 text-3xl font-bold" style="color: #86efac;">
            {seriesSummary.matchedPlayers}
          </div>
        </div>
        <div
          class="rounded-lg border p-4"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
        >
          <div class="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle size={16} /> Unmatched Players
          </div>
          <div class="mt-2 text-3xl font-bold" style="color: #fca5a5;">
            {seriesSummary.unmatchedPlayers}
          </div>
        </div>
        <div
          class="rounded-lg border p-4"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
        >
          <div class="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 size={16} /> Teams Matched
          </div>
          <div class="mt-2 text-3xl font-bold" style="color: var(--title);">
            {seriesSummary.first && teamNameMap.get(normalizeKey(seriesSummary.first.teamAName))
              ? 1
              : 0 +
                (seriesSummary.first && teamNameMap.get(normalizeKey(seriesSummary.first.teamBName))
                  ? 1
                  : 0)}/2
          </div>
        </div>
      </section>

      <section
        class="rounded-lg border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <div class="text-sm font-semibold" style="color: var(--text);">Series Summary</div>
            <div class="text-xs" style="color: rgba(255,255,255,0.7);">
              Review the series-level match info and each imported map below.
            </div>
          </div>
          <button
            type="button"
            class="rounded-md px-3 py-2 text-sm font-semibold"
            style="background: rgba(59,130,246,0.18); color: #93c5fd;"
            onclick={submitImport}
            disabled={isSubmitting || seriesMaps.length === 0}
          >
            {#if isSubmitting}<span class="inline-flex items-center gap-2"
                ><Loader2 size={16} class="animate-spin" /> Importing...</span
              >{:else}Import Series{/if}
          </button>
        </div>

        {#if seriesSummary.first}
          <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div
              class="rounded-md border p-3"
              style="border-color: rgba(255,255,255,0.10); background: rgba(255,255,255,0.04);"
            >
              <div class="text-xs uppercase" style="color: rgba(255,255,255,0.7);">Teams</div>
              <div class="mt-1 font-semibold" style="color: var(--text);">
                {seriesSummary.first.teamAName} vs {seriesSummary.first.teamBName}
              </div>
            </div>
            <div
              class="rounded-md border p-3"
              style="border-color: rgba(255,255,255,0.10); background: rgba(255,255,255,0.04);"
            >
              <div class="text-xs uppercase" style="color: rgba(255,255,255,0.7);">
                Series Score
              </div>
              <div class="mt-1 font-semibold" style="color: var(--text);">
                {seriesSummary.seriesWinsA}-{seriesSummary.seriesWinsB}
              </div>
            </div>
            <div
              class="rounded-md border p-3"
              style="border-color: rgba(255,255,255,0.10); background: rgba(255,255,255,0.04);"
            >
              <div class="text-xs uppercase" style="color: rgba(255,255,255,0.7);">Date</div>
              <div class="mt-1 font-semibold" style="color: var(--text);">
                {seriesSummary.first.scheduledAt || '—'}
              </div>
            </div>
          </div>

          <div class="mt-4 space-y-3">
            {#each seriesMaps as map, index}
              <div
                class="rounded-md border p-3"
                style="border-color: rgba(255,255,255,0.10); background: rgba(255,255,255,0.04);"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="font-semibold" style="color: var(--text);">
                    Map {index + 1}: {map.mapName || '—'}
                  </div>
                  <div class="text-sm" style="color: rgba(255,255,255,0.78);">
                    {map.teamARounds}-{map.teamBRounds}
                  </div>
                </div>
                <div class="mt-1 text-xs" style="color: rgba(255,255,255,0.62);">
                  {map.sourceFilename}
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <div class="text-sm" style="color: rgba(255,255,255,0.72);">No series parsed yet.</div>
        {/if}
      </section>
    </div>
  </div>
</PageContainer>
