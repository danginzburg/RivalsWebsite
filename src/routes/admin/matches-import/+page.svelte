<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { Swords, Upload, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-svelte'

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

  let fileName = $state('')
  let displayName = $state('')
  let teamAName = $state('')
  let teamBName = $state('')
  let scheduledAt = $state('')
  let mapName = $state('')
  let teamARounds = $state(0)
  let teamBRounds = $state(0)
  let playerRows = $state<ParsedPlayerRow[]>([])
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
      for (const alias of Array.isArray(team.metadata?.match_import_names)
        ? team.metadata.match_import_names
        : []) {
        map.set(normalizeKey(alias), team.id)
      }
    }
    return map
  })

  const stats = $derived.by(() => {
    const matched = playerRows.filter((row) => row.profile_id).length
    return {
      total: playerRows.length,
      matched,
      unmatched: playerRows.length - matched,
      teamsMatched:
        (teamNameMap.get(normalizeKey(teamAName)) ? 1 : 0) +
        (teamNameMap.get(normalizeKey(teamBName)) ? 1 : 0),
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

  function parseCsv(text: string) {
    const lines = text.split(/\r?\n/)
    const meaningful = lines.map((line) => line.trim()).filter(Boolean)
    if (meaningful.length < 3)
      throw new Error('CSV must include headers, players, and match summary rows')

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
      if (!header.includes(column)) throw new Error(`CSV missing required column: ${column}`)
    }

    const playerLines: string[] = []
    let footerLine = ''
    for (let i = 1; i < lines.length; i++) {
      const rawLine = lines[i]
      if (!rawLine.trim()) continue
      const parts = rawLine.split(',').map((part) => part.trim())
      if (parts[2] && !Number.isFinite(Number(parts[2]))) {
        footerLine = rawLine
        break
      }
      playerLines.push(rawLine)
    }

    if (playerLines.length === 0 || !footerLine)
      throw new Error('Could not find player rows and footer row')

    const footer = footerLine.split(',').map((part) => part.trim())
    teamAName = footer[0] ?? ''
    teamBName = footer[1] ?? ''
    scheduledAt = footer[2] ?? ''
    teamARounds = parseNumber(footer[3])
    teamBRounds = parseNumber(footer[5])
    mapName = footer[7] ?? ''

    const half = Math.ceil(playerLines.length / 2)
    playerRows = playerLines.map((line, index) => {
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
      }
    })
  }

  function handleFile(file: File) {
    parseError = null
    submitMessage = null
    fileName = file.name
    displayName = file.name

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        parseCsv(String(event.target?.result ?? ''))
      } catch (err) {
        parseError = err instanceof Error ? err.message : 'Failed to parse match CSV'
        playerRows = []
      }
    }
    reader.readAsText(file)
  }

  async function submitImport() {
    isSubmitting = true
    submitMessage = null

    try {
      const response = await fetch('/api/admin/matches/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceFilename: fileName,
          displayName,
          teamAName,
          teamBName,
          scheduledAt,
          mapName,
          teamARounds,
          teamBRounds,
          playerRows,
        }),
      })

      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message ?? 'Failed to import match CSV')

      submitMessage = result.unresolvedPlayers?.length
        ? `Imported match map. Unmatched players: ${result.unresolvedPlayers.join(', ')}`
        : 'Imported match map successfully.'
      playerRows = []
      fileName = ''
      displayName = ''
    } catch (err) {
      submitMessage = err instanceof Error ? err.message : 'Failed to import match CSV'
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
            Upload per-map CSV exports. Team names resolve from full approved team names.
          </p>
          <p class="text-xs" style="color: rgba(255,255,255,0.6);">
            Matches can be auto-created from imports, but the teams must already exist as approved
            teams.
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
          <span>{fileName || 'Choose match CSV'}</span>
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
      </section>

      <section class="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div
          class="rounded-lg border p-4"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
        >
          <div class="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 size={16} /> Players
          </div>
          <div class="mt-2 text-3xl font-bold" style="color: var(--title);">{stats.total}</div>
        </div>
        <div
          class="rounded-lg border p-4"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
        >
          <div class="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 size={16} /> Matched Players
          </div>
          <div class="mt-2 text-3xl font-bold" style="color: #86efac;">{stats.matched}</div>
        </div>
        <div
          class="rounded-lg border p-4"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
        >
          <div class="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle size={16} /> Unmatched Players
          </div>
          <div class="mt-2 text-3xl font-bold" style="color: #fca5a5;">{stats.unmatched}</div>
        </div>
        <div
          class="rounded-lg border p-4"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
        >
          <div class="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 size={16} /> Teams Matched
          </div>
          <div class="mt-2 text-3xl font-bold" style="color: var(--title);">
            {stats.teamsMatched}/2
          </div>
        </div>
      </section>

      <section
        class="rounded-lg border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <div class="text-sm font-semibold" style="color: var(--text);">Match Summary</div>
            <div class="text-xs" style="color: rgba(255,255,255,0.7);">
              Review the inferred teams, date, and map before import.
            </div>
          </div>
          <button
            type="button"
            class="rounded-md px-3 py-2 text-sm font-semibold"
            style="background: rgba(59,130,246,0.18); color: #93c5fd;"
            onclick={submitImport}
            disabled={isSubmitting || playerRows.length === 0 || stats.teamsMatched < 2}
          >
            {#if isSubmitting}
              <span class="inline-flex items-center gap-2"
                ><Loader2 size={16} class="animate-spin" /> Importing...</span
              >
            {:else}
              Import Match Map
            {/if}
          </button>
        </div>

        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div
            class="rounded-md border p-3"
            style="border-color: rgba(255,255,255,0.10); background: rgba(255,255,255,0.04);"
          >
            <div class="text-xs uppercase" style="color: rgba(255,255,255,0.7);">Teams</div>
            <div class="mt-1 font-semibold" style="color: var(--text);">
              {teamAName || '—'} vs {teamBName || '—'}
            </div>
          </div>
          <div
            class="rounded-md border p-3"
            style="border-color: rgba(255,255,255,0.10); background: rgba(255,255,255,0.04);"
          >
            <div class="text-xs uppercase" style="color: rgba(255,255,255,0.7);">Map</div>
            <div class="mt-1 font-semibold" style="color: var(--text);">
              {mapName || '—'} • {teamARounds}-{teamBRounds}
            </div>
          </div>
        </div>

        <div class="mt-3 text-sm" style="color: rgba(255,255,255,0.75);">
          Date: {scheduledAt || '—'}
        </div>

        {#if playerRows.length > 0}
          <div class="mt-4 overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead>
                <tr class="text-xs uppercase" style="color: rgba(255,255,255,0.75);">
                  <th class="px-3 py-2">Side</th>
                  <th class="px-3 py-2">Player</th>
                  <th class="px-3 py-2">Agent</th>
                  <th class="px-3 py-2">ACS</th>
                  <th class="px-3 py-2">K/D/A</th>
                  <th class="px-3 py-2">Match</th>
                </tr>
              </thead>
              <tbody>
                {#each playerRows as row}
                  <tr class="border-t" style="border-color: rgba(255,255,255,0.10);">
                    <td class="px-3 py-2">{row.side === 'a' ? 'A' : 'B'}</td>
                    <td class="px-3 py-2 font-semibold" style="color: var(--text);"
                      >{row.player_name}</td
                    >
                    <td class="px-3 py-2">{row.agents}</td>
                    <td class="px-3 py-2">{row.acs}</td>
                    <td class="px-3 py-2">{row.kills}/{row.deaths}/{row.assists}</td>
                    <td
                      class="px-3 py-2"
                      style={`color: ${row.profile_id ? '#86efac' : '#fca5a5'};`}
                    >
                      {row.profile_id ? 'Matched' : 'Unmatched'}
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
