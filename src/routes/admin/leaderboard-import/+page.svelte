<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { Trophy, Upload, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-svelte'

  let { data } = $props() as { data: any }
  const seasons = $derived((data.seasons ?? []) as any[])

  type ParsedRow = {
    team: string
    points: number
    series_played: number
    series_wins: number
    series_losses: number
    maps_played: number
    map_wins: number
    map_losses: number
    round_diff: number
    matchedTeamId: string | null
  }

  let parsedRows = $state<ParsedRow[]>([])
  let fileName = $state('')
  let displayName = $state('')
  let seasonId = $state('')
  let split = $state('main')
  let asOfDate = $state(new Date().toISOString().slice(0, 10))
  let parseError = $state<string | null>(null)
  let submitMessage = $state<string | null>(null)
  let isSubmitting = $state(false)
  let unmatchedTeams = $state<string[]>([])

  function normalizeKey(value: unknown) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
  }

  const teamMap = $derived.by(() => {
    const map = new Map<string, string>()
    for (const team of data.teams ?? []) {
      if (team.tag) map.set(normalizeKey(team.tag), team.id)
      for (const alias of Array.isArray(team.metadata?.leaderboard_import_tags)
        ? team.metadata.leaderboard_import_tags
        : []) {
        map.set(normalizeKey(alias), team.id)
      }
    }
    return map
  })

  const seasonOptions = $derived(
    seasons.map((season: any) => ({
      value: season.id,
      label: season.is_active ? `${season.name} (Active)` : season.name,
    }))
  )

  $effect(() => {
    if (seasonId) return
    seasonId = seasons.find((season: any) => season.is_active)?.id ?? seasons[0]?.id ?? ''
  })

  const stats = $derived.by(() => {
    const matched = parsedRows.filter((row) => row.matchedTeamId).length
    return {
      total: parsedRows.length,
      matched,
      unmatched: parsedRows.length - matched,
    }
  })

  function parseInteger(value: string) {
    const n = Number(String(value ?? '').trim())
    return Number.isFinite(n) ? Math.trunc(n) : 0
  }

  function parseCSV(text: string) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
    if (lines.length < 2) throw new Error('CSV must include a header and at least one data row')

    const headers = lines[0].split(',').map((header) => header.trim().toUpperCase())
    const required = [
      'TEAM',
      'POINTS',
      '# SERIES',
      'SERIES WINS',
      'SERIES LOSSES',
      '# MAPS',
      'MAP WINS',
      'MAP LOSSES',
      'ROUND DIFF',
    ]
    for (const column of required) {
      if (!headers.includes(column)) throw new Error(`CSV missing required column: ${column}`)
    }

    const index = (name: string) => headers.indexOf(name)

    parsedRows = lines.slice(1).map((line) => {
      const parts = line.split(',')
      const team = parts[index('TEAM')]?.trim() ?? ''
      return {
        team,
        points: parseInteger(parts[index('POINTS')]),
        series_played: parseInteger(parts[index('# SERIES')]),
        series_wins: parseInteger(parts[index('SERIES WINS')]),
        series_losses: parseInteger(parts[index('SERIES LOSSES')]),
        maps_played: parseInteger(parts[index('# MAPS')]),
        map_wins: parseInteger(parts[index('MAP WINS')]),
        map_losses: parseInteger(parts[index('MAP LOSSES')]),
        round_diff: parseInteger(parts[index('ROUND DIFF')]),
        matchedTeamId: teamMap.get(normalizeKey(team)) ?? null,
      }
    })
  }

  function handleFile(file: File) {
    parseError = null
    submitMessage = null
    fileName = file.name
    if (!displayName.trim()) displayName = file.name

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        parseCSV(String(event.target?.result ?? ''))
      } catch (err) {
        parseError = err instanceof Error ? err.message : 'Failed to parse leaderboard CSV'
        parsedRows = []
      }
    }
    reader.readAsText(file)
  }

  async function submitImport() {
    isSubmitting = true
    submitMessage = null

    try {
      const response = await fetch('/api/admin/leaderboard/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: parsedRows,
          seasonId,
          split,
          asOfDate,
          sourceFilename: fileName,
          displayName,
        }),
      })

      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message ?? 'Failed to import leaderboard')

      unmatchedTeams = result.unmatchedTeams ?? []
      submitMessage = result.skipped
        ? `Imported ${result.imported} leaderboard rows and skipped ${result.skipped} unmatched team${result.skipped === 1 ? '' : 's'}.`
        : `Imported ${result.imported} leaderboard rows.`
      parsedRows = []
      fileName = ''
      displayName = ''
    } catch (err) {
      submitMessage = err instanceof Error ? err.message : 'Failed to import leaderboard'
    } finally {
      isSubmitting = false
    }
  }
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-6xl space-y-6">
      <div class="flex items-center gap-3">
        <Trophy size={34} style="color: var(--text);" />
        <div>
          <h1 class="responsive-title">Leaderboard Import</h1>
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">
            Upload standings by team tag. The newest import becomes the public leaderboard.
          </p>
        </div>
      </div>

      <section
        class="rounded-lg border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <div class="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <div
              class="mb-1 text-xs font-semibold uppercase"
              style="color: rgba(255,255,255,0.72);"
            >
              Season
            </div>
            {#if seasonOptions.length > 0}
              <CustomSelect
                options={[{ value: '', label: 'No season' }, ...seasonOptions]}
                value={seasonId}
                onSelect={(value) => (seasonId = value)}
              />
            {:else}
              <div
                class="rounded-md border px-3 py-2 text-sm"
                style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: rgba(255,255,255,0.72);"
              >
                No seasons found. Import will be saved without a season.
              </div>
            {/if}
          </div>
          <label class="text-sm" style="color: var(--text);">
            <div
              class="mb-1 text-xs font-semibold uppercase"
              style="color: rgba(255,255,255,0.72);"
            >
              Split
            </div>
            <input
              bind:value={split}
              class="w-full rounded-md border px-3 py-2"
              style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
            />
          </label>
          <label class="text-sm" style="color: var(--text);">
            <div
              class="mb-1 text-xs font-semibold uppercase"
              style="color: rgba(255,255,255,0.72);"
            >
              As Of Date
            </div>
            <input
              type="date"
              bind:value={asOfDate}
              class="w-full rounded-md border px-3 py-2"
              style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
            />
          </label>
          <label class="text-sm" style="color: var(--text);">
            <div
              class="mb-1 text-xs font-semibold uppercase"
              style="color: rgba(255,255,255,0.72);"
            >
              Display Name
            </div>
            <input
              bind:value={displayName}
              class="w-full rounded-md border px-3 py-2"
              style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
              placeholder="Leaderboard Import"
            />
          </label>
        </div>

        <label
          class="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-4 py-6 text-sm font-semibold"
          style="border-color: rgba(255,255,255,0.18); color: var(--text);"
        >
          <Upload size={16} />
          <span>{fileName || 'Choose leaderboard CSV'}</span>
          <input
            type="file"
            accept=".csv"
            class="hidden"
            onchange={(event) => {
              const file = (event.currentTarget as HTMLInputElement).files?.[0]
              if (file) handleFile(file)
            }}
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

        {#if unmatchedTeams.length > 0}
          <div
            class="mt-3 rounded-md border p-3 text-sm"
            style="border-color: rgba(250,204,21,0.35); background: rgba(250,204,21,0.08); color: #fde68a;"
          >
            Skipped unmatched tags: {unmatchedTeams.join(', ')}
          </div>
        {/if}
      </section>

      <section class="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div
          class="rounded-lg border p-4"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
        >
          <div class="flex items-center gap-2 text-sm font-semibold" style="color: var(--text);">
            <CheckCircle2 size={16} /> Parsed Rows
          </div>
          <div class="mt-2 text-3xl font-bold" style="color: var(--title);">{stats.total}</div>
        </div>
        <div
          class="rounded-lg border p-4"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
        >
          <div class="flex items-center gap-2 text-sm font-semibold" style="color: var(--text);">
            <CheckCircle2 size={16} /> Matched Tags
          </div>
          <div class="mt-2 text-3xl font-bold" style="color: #86efac;">{stats.matched}</div>
        </div>
        <div
          class="rounded-lg border p-4"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
        >
          <div class="flex items-center gap-2 text-sm font-semibold" style="color: var(--text);">
            <AlertTriangle size={16} /> Unmatched Tags
          </div>
          <div class="mt-2 text-3xl font-bold" style="color: #fca5a5;">{stats.unmatched}</div>
        </div>
      </section>

      <section
        class="rounded-lg border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <div class="text-sm font-semibold" style="color: var(--text);">Preview</div>
            <div class="text-xs" style="color: rgba(255,255,255,0.7);">
              Rows import in their current order as ranks. Unmatched tags will be skipped instead of
              blocking the import.
            </div>
          </div>
          <button
            type="button"
            class="rounded-md px-3 py-2 text-sm font-semibold"
            style="background: rgba(59,130,246,0.18); color: #93c5fd;"
            onclick={submitImport}
            disabled={isSubmitting || parsedRows.length === 0}
          >
            {#if isSubmitting}
              <span class="inline-flex items-center gap-2"
                ><Loader2 size={16} class="animate-spin" /> Importing...</span
              >
            {:else}
              Import Leaderboard
            {/if}
          </button>
        </div>

        {#if parsedRows.length === 0}
          <div class="text-sm" style="color: rgba(255,255,255,0.72);">No CSV parsed yet.</div>
        {:else}
          <div class="overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead>
                <tr class="text-xs uppercase" style="color: rgba(255,255,255,0.75);">
                  <th class="px-3 py-2">Rank</th>
                  <th class="px-3 py-2">Team</th>
                  <th class="px-3 py-2">Points</th>
                  <th class="px-3 py-2">Series</th>
                  <th class="px-3 py-2">Maps</th>
                  <th class="px-3 py-2">Round Diff</th>
                  <th class="px-3 py-2">Match</th>
                </tr>
              </thead>
              <tbody>
                {#each parsedRows as row, index}
                  <tr class="border-t" style="border-color: rgba(255,255,255,0.10);">
                    <td class="px-3 py-2">{index + 1}</td>
                    <td class="px-3 py-2 font-semibold" style="color: var(--text);">{row.team}</td>
                    <td class="px-3 py-2">{row.points}</td>
                    <td class="px-3 py-2"
                      >{row.series_wins}-{row.series_losses} ({row.series_played})</td
                    >
                    <td class="px-3 py-2">{row.map_wins}-{row.map_losses} ({row.maps_played})</td>
                    <td class="px-3 py-2">{row.round_diff}</td>
                    <td
                      class="px-3 py-2"
                      style={`color: ${row.matchedTeamId ? '#86efac' : '#fca5a5'};`}
                    >
                      {row.matchedTeamId ? 'Matched' : 'Unmatched'}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>
    </div>
  </div>
</PageContainer>
