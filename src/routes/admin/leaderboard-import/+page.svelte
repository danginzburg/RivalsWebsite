<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { Upload, CheckCircle2, AlertTriangle, Loader2, ArrowLeft } from 'lucide-svelte'
  import { resolve } from '$app/paths'
  import { SvelteMap } from 'svelte/reactivity'
  import {
    parseLeaderboardCsvWithMapping,
    readCsvHeaders,
    guessMapping,
    missingRequiredFields,
    LEADERBOARD_FIELDS,
    type LeaderboardMapping,
  } from '$lib/admin/leaderboard-csv'

  let { data }: PageProps = $props()
  const seasons = $derived(data.seasons ?? [])

  let rawText = $state('')
  let headers = $state<string[]>([])
  let mapping = $state<LeaderboardMapping | null>(null)
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
    const map = new SvelteMap<string, string>()
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
    seasons.map((season: { id: string; name: string; is_active?: boolean | null }) => ({
      value: season.id,
      label: season.is_active ? `${season.name} (Active)` : season.name,
    }))
  )

  $effect(() => {
    if (seasonId) return
    seasonId =
      seasons.find((season: { id: string; is_active?: boolean | null }) => season.is_active)?.id ??
      seasons[0]?.id ??
      ''
  })

  /** The dropdown for every field offers "none" plus each header in the file. */
  const columnOptions = $derived([
    { value: '', label: '— Not mapped —' },
    ...headers.map((header) => ({ value: header, label: header })),
  ])

  const missingRequired = $derived(mapping ? missingRequiredFields(mapping) : [])

  /**
   * Rows and the ignored-column list are recomputed whenever the mapping
   * changes, so adjusting a dropdown updates the preview live. Parsing throws
   * only on a structurally unusable file (or an unmapped TEAM), surfaced as a
   * parse error rather than a crash.
   */
  const parsed = $derived.by(() => {
    if (!rawText || !mapping) {
      return { rows: [], unmappedColumns: [] as string[], error: null as string | null }
    }
    try {
      const result = parseLeaderboardCsvWithMapping(rawText, mapping)
      return { rows: result.rows, unmappedColumns: result.unmappedColumns, error: null }
    } catch (err) {
      return {
        rows: [],
        unmappedColumns: [],
        error: err instanceof Error ? err.message : 'Failed to parse leaderboard CSV',
      }
    }
  })

  const parsedRows = $derived(
    parsed.rows.map((row) => ({
      ...row,
      matchedTeamId: teamMap.get(normalizeKey(row.team)) ?? null,
    }))
  )

  const stats = $derived.by(() => {
    const matched = parsedRows.filter((row) => row.matchedTeamId).length
    return {
      total: parsedRows.length,
      matched,
      unmatched: parsedRows.length - matched,
    }
  })

  function setMapping(field: string, value: string) {
    if (!mapping) return
    mapping = { ...mapping, [field]: value || null }
  }

  function handleFile(file: File) {
    parseError = null
    submitMessage = null
    unmatchedTeams = []
    fileName = file.name
    if (!displayName.trim()) displayName = file.name

    const reader = new FileReader()
    reader.onerror = () => {
      parseError = 'Failed to read the CSV file'
    }
    reader.onload = (event) => {
      const text = String(event.target?.result ?? '')
      const fileHeaders = readCsvHeaders(text)
      if (fileHeaders.length === 0) {
        parseError = 'That CSV has no header row'
        rawText = ''
        headers = []
        mapping = null
        return
      }
      rawText = text
      headers = fileHeaders
      mapping = guessMapping(fileHeaders)
    }
    reader.readAsText(file)
  }

  async function submitImport() {
    if (!mapping) return
    isSubmitting = true
    submitMessage = null

    try {
      const response = await window.fetch('/api/admin/leaderboard/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: parsedRows,
          seasonId,
          split,
          asOfDate,
          sourceFilename: fileName,
          displayName,
          sourceMapping: mapping,
        }),
      })

      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message ?? 'Failed to import leaderboard')

      unmatchedTeams = result.unmatchedTeams ?? []
      submitMessage = result.skipped
        ? `Imported ${result.imported} leaderboard rows and skipped ${result.skipped} unmatched team${result.skipped === 1 ? '' : 's'}.`
        : `Imported ${result.imported} leaderboard rows.`
      rawText = ''
      headers = []
      mapping = null
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
  <div class="flex justify-center py-6 sm:py-8">
    <div class="w-full max-w-6xl space-y-5">
      <header class="admin-import-head">
        <div class="min-w-0">
          <h1 class="admin-import-title">Leaderboard Import</h1>
          <p class="admin-hint mt-1">
            Upload standings by team tag. The newest import becomes the public leaderboard.
          </p>
        </div>
        <a href={resolve('/admin')} class="admin-back-link">
          <ArrowLeft size={14} /> Admin
        </a>
      </header>

      <section class="admin-card admin-card-pad">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div class="admin-field-label">Season</div>
            {#if seasonOptions.length > 0}
              <CustomSelect
                options={[{ value: '', label: 'No season' }, ...seasonOptions]}
                value={seasonId}
                onSelect={(value) => (seasonId = value)}
              />
            {:else}
              <div class="admin-note">No seasons found. Import will be saved without a season.</div>
            {/if}
          </div>
          <label class="block">
            <div class="admin-field-label">Split</div>
            <input bind:value={split} class="admin-input" />
          </label>
          <label class="block">
            <div class="admin-field-label">As Of Date</div>
            <input type="date" bind:value={asOfDate} class="admin-input" />
          </label>
          <label class="block">
            <div class="admin-field-label">Display Name</div>
            <input bind:value={displayName} class="admin-input" placeholder="Leaderboard Import" />
          </label>
        </div>

        <label class="admin-dropzone mt-4">
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
          <div class="admin-alert admin-alert-error mt-3">
            {parseError}
          </div>
        {/if}

        {#if parsed.error}
          <div class="admin-alert admin-alert-error mt-3">
            {parsed.error}
          </div>
        {/if}

        {#if submitMessage}
          <div class="admin-note mt-3">
            {submitMessage}
          </div>
        {/if}

        {#if unmatchedTeams.length > 0}
          <div class="admin-alert admin-alert-warn mt-3">
            Skipped unmatched tags: {unmatchedTeams.join(', ')}
          </div>
        {/if}
      </section>

      {#if headers.length > 0 && mapping}
        <section class="admin-card admin-card-pad">
          <div class="admin-section-title">Column Mapping</div>
          <div class="admin-hint mt-1">
            Each stat is matched to a column from your file automatically. Adjust any that guessed
            wrong; the preview below updates as you go. Team and Points are required.
          </div>

          <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {#each LEADERBOARD_FIELDS as field (field.id)}
              <div>
                <div class="admin-field-label">
                  {field.label}{#if field.required}<span style="color: #fca5a5;"> *</span>{/if}
                </div>
                <CustomSelect
                  options={columnOptions}
                  value={mapping[field.id] ?? ''}
                  onSelect={(value) => setMapping(field.id, value)}
                />
              </div>
            {/each}
          </div>

          {#if missingRequired.length > 0}
            <div class="admin-alert admin-alert-error mt-3">
              Map a column for {missingRequired.map((field) => field.label).join(' and ')} before importing.
            </div>
          {/if}

          {#if parsed.unmappedColumns.length > 0}
            <div class="admin-alert admin-alert-warn mt-3">
              These columns are not being imported: {parsed.unmappedColumns.join(', ')}
            </div>
          {/if}
        </section>
      {/if}

      <section class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div class="admin-stat">
          <div class="admin-stat-label"><CheckCircle2 size={14} /> Parsed Rows</div>
          <div class="admin-stat-value">{stats.total}</div>
        </div>
        <div class="admin-stat">
          <div class="admin-stat-label"><CheckCircle2 size={14} /> Matched Tags</div>
          <div class="admin-stat-value" style="color: #86efac;">{stats.matched}</div>
        </div>
        <div class="admin-stat">
          <div class="admin-stat-label"><AlertTriangle size={14} /> Unmatched Tags</div>
          <div class="admin-stat-value" style="color: #fca5a5;">{stats.unmatched}</div>
        </div>
      </section>

      <section class="admin-card admin-card-pad">
        <div class="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0">
            <div class="admin-section-title">Preview</div>
            <div class="admin-hint mt-1">
              Rows import in their current order as ranks. Unmatched tags will be skipped instead of
              blocking the import.
            </div>
          </div>
          <button
            type="button"
            class="admin-btn admin-btn-info flex-shrink-0"
            onclick={submitImport}
            disabled={isSubmitting || parsedRows.length === 0 || missingRequired.length > 0}
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
          <div class="table-scroll">
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
                {#each parsedRows as row, index (index)}
                  <tr class="admin-divide border-t">
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
