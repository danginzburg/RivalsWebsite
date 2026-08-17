<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { Upload, Loader2, AlertTriangle, CheckCircle2, Layers3, ArrowLeft } from 'lucide-svelte'
  import { resolve } from '$app/paths'

  const riotBestOfOptions = [
    { value: '', label: 'Auto' },
    { value: '1', label: 'Bo1' },
    { value: '3', label: 'Bo3' },
    { value: '5', label: 'Bo5' },
  ]

  const riotRegionOptions = [
    { value: 'na', label: 'NA' },
    { value: 'eu', label: 'EU' },
    { value: 'ap', label: 'AP' },
    { value: 'kr', label: 'KR' },
    { value: 'br', label: 'BR' },
    { value: 'latam', label: 'LATAM' },
  ]

  const forfeitBestOfOptions = [
    { value: '1', label: 'Bo1' },
    { value: '3', label: 'Bo3' },
    { value: '5', label: 'Bo5' },
    { value: '7', label: 'Bo7' },
  ]

  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

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

  type ImportMode = 'riot_links' | 'series_csv' | 'forfeit_no_show'

  /**
   * Tracker links are the default now that matches can be read straight from
   * Riot, but the CSV path stays exactly as it was: it is the only way to
   * import a match older than Riot's retention window, or one whose scoreboard
   * needs correcting by hand after a rollback.
   */
  let importMode = $state<ImportMode>('riot_links')

  let riotInput = $state('')
  let riotRegion = $state('na')
  /**
   * Empty means infer from the map count, which is right only when the series
   * went the distance: a Bo5 won 3-1 has four maps and would otherwise be
   * recorded as a Bo3, and a Bo3 won 2-0 as a Bo1.
   */
  let riotBestOf = $state('')
  let riotDryRun = $state(false)

  type RiotPreview = {
    teamA: { id: string; name: string; rosterVotes: number }
    teamB: { id: string; name: string; rosterVotes: number }
    unmatchedPlayers: string[]
    maps: Array<{
      matchId: string
      mapName: string | null
      score: string
      playerCount: number
    }>
  }

  let riotPreview = $state<RiotPreview | null>(null)

  /** Preview first, then import — the failure worth catching is wrong teams. */
  async function runRiotImport(dryRun: boolean) {
    isSubmitting = true
    riotDryRun = dryRun
    parseError = null
    submitMessage = null

    try {
      const response = await fetch('/api/admin/matches/import-riot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input: riotInput,
          region: riotRegion,
          dryRun,
          ...(riotBestOf ? { bestOf: Number(riotBestOf) } : {}),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message ?? 'Import failed')

      riotPreview = payload.preview ?? null
      submitMessage = dryRun
        ? 'Preview only — nothing has been saved yet.'
        : `Imported ${payload.preview?.maps?.length ?? 0} map(s) for ${payload.preview?.teamA?.name} vs ${payload.preview?.teamB?.name}.`
      if (!dryRun) riotInput = ''
    } catch (err) {
      parseError = err instanceof Error ? err.message : 'Import failed'
    } finally {
      isSubmitting = false
      riotDryRun = false
    }
  }
  let fileName = $state('')
  let displayName = $state('')
  let seriesMaps = $state<ParsedMap[]>([])
  let parseError = $state<string | null>(null)
  let submitMessage = $state<string | null>(null)
  let isSubmitting = $state(false)

  let officialWinnerSide = $state<'map' | 'a' | 'b'>('map')
  let forfeitReason = $state('')
  let mapNoteByOrder = $state<Record<string, string>>({})

  let ffTeamAId = $state('')
  let ffTeamBId = $state('')
  let ffScheduledAt = $state('')
  let ffWinnerTeamId = $state('')
  let ffTeamAScore = $state(2)
  let ffTeamBScore = $state(0)
  let ffBestOf = $state(3)

  function normalizeKey(value: unknown) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
  }

  function normalizeBase(value: unknown) {
    return normalizeKey(String(value ?? '').split('#')[0] ?? '')
  }

  function sameTeams(first: ParsedMap, next: ParsedMap) {
    const a = [normalizeKey(first.teamAName), normalizeKey(first.teamBName)].sort()
    const b = [normalizeKey(next.teamAName), normalizeKey(next.teamBName)].sort()
    return a[0] === b[0] && a[1] === b[1]
  }

  function isFlippedAgainst(first: ParsedMap, next: ParsedMap) {
    return (
      normalizeKey(next.teamAName) === normalizeKey(first.teamBName) &&
      normalizeKey(next.teamBName) === normalizeKey(first.teamAName)
    )
  }

  const profileMap = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- key/value lookup for CSV matching
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
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- key/value lookup for CSV matching
    const map = new Map<string, string>()
    for (const team of data.teams ?? []) {
      map.set(normalizeKey(team.name), team.id)
      const meta = team.metadata as Record<string, unknown> | null | undefined
      const aliases = meta?.match_import_names
      if (Array.isArray(aliases)) {
        for (const a of aliases) {
          const s = String(a ?? '').trim()
          if (s) map.set(normalizeKey(s), team.id)
        }
      }
    }
    return map
  })

  const mapWinnerTeamId = $derived.by(() => {
    const first = seriesMaps[0] ?? null
    if (!first) return null as string | null
    const idA = teamNameMap.get(normalizeKey(first.teamAName)) ?? null
    const idB = teamNameMap.get(normalizeKey(first.teamBName)) ?? null
    if (!idA || !idB) return null

    const canonicalizedMaps = seriesMaps.map((map) => {
      const flipped = isFlippedAgainst(first, map)
      return {
        canonicalTeamARounds: flipped ? map.teamBRounds : map.teamARounds,
        canonicalTeamBRounds: flipped ? map.teamARounds : map.teamBRounds,
      }
    })
    const winsA = canonicalizedMaps.filter(
      (m) => m.canonicalTeamARounds > m.canonicalTeamBRounds
    ).length
    const winsB = canonicalizedMaps.filter(
      (m) => m.canonicalTeamBRounds > m.canonicalTeamARounds
    ).length
    if (winsA === winsB) return null
    return winsA > winsB ? idA : idB
  })

  const seriesSummary = $derived.by(() => {
    const first = seriesMaps[0] ?? null
    const matchedPlayers = seriesMaps
      .flatMap((map) => map.playerRows)
      .filter((row) => row.profile_id).length
    const totalPlayers = seriesMaps.flatMap((map) => map.playerRows).length
    const canonicalizedMaps = first
      ? seriesMaps.map((map) => {
          const flipped = isFlippedAgainst(first, map)
          return {
            ...map,
            canonicalTeamARounds: flipped ? map.teamBRounds : map.teamARounds,
            canonicalTeamBRounds: flipped ? map.teamARounds : map.teamBRounds,
          }
        })
      : []
    const seriesWinsA = canonicalizedMaps.filter(
      (map) => map.canonicalTeamARounds > map.canonicalTeamBRounds
    ).length
    const seriesWinsB = canonicalizedMaps.filter(
      (map) => map.canonicalTeamBRounds > map.canonicalTeamARounds
    ).length
    const teamsMatched =
      (first && teamNameMap.get(normalizeKey(first.teamAName)) ? 1 : 0) +
      (first && teamNameMap.get(normalizeKey(first.teamBName)) ? 1 : 0)
    return {
      first,
      mapCount: seriesMaps.length,
      totalPlayers,
      matchedPlayers,
      unmatchedPlayers: totalPlayers - matchedPlayers,
      teamsMatched,
      seriesWinsA,
      seriesWinsB,
    }
  })

  const showForfeitExtras = $derived.by(() => {
    const first = seriesMaps[0] ?? null
    if (!first || officialWinnerSide === 'map') return false
    const idA = teamNameMap.get(normalizeKey(first.teamAName)) ?? null
    const idB = teamNameMap.get(normalizeKey(first.teamBName)) ?? null
    const officialTeamId =
      officialWinnerSide === 'a' ? idA : officialWinnerSide === 'b' ? idB : null
    if (!officialTeamId) return false
    return mapWinnerTeamId === null || officialTeamId !== mapWinnerTeamId
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
        if (!sameTeams(first, map)) {
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
      if (importMode === 'forfeit_no_show') {
        const teams = data.teams ?? []
        const teamA = teams.find((t) => t.id === ffTeamAId)
        const teamB = teams.find((t) => t.id === ffTeamBId)
        if (!teamA || !teamB) throw new Error('Select both teams for the forfeit.')
        if (teamA.id === teamB.id) throw new Error('Teams must be different.')
        const response = await window.fetch('/api/admin/matches/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            importKind: 'forfeit_no_show',
            displayName: displayName.trim() || 'forfeit-no-show',
            teamAName: teamA.name,
            teamBName: teamB.name,
            scheduledAt: ffScheduledAt.trim(),
            winnerTeamId: ffWinnerTeamId.trim(),
            teamAScore: ffTeamAScore,
            teamBScore: ffTeamBScore,
            bestOf: ffBestOf,
          }),
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.message ?? 'Failed to record forfeit')
        submitMessage = `Forfeit match saved (match id ${result.matchId ?? '—'}).`
        return
      }

      const first = seriesMaps[0] ?? null
      const idA = first ? teamNameMap.get(normalizeKey(first.teamAName)) : null
      const idB = first ? teamNameMap.get(normalizeKey(first.teamBName)) : null

      const officialTeamId =
        officialWinnerSide === 'a' ? idA : officialWinnerSide === 'b' ? idB : null

      if (seriesSummary.seriesWinsA === seriesSummary.seriesWinsB) {
        if (officialWinnerSide === 'map' || !officialTeamId) {
          throw new Error(
            'Series is tied on maps — choose an official series winner (Team A or B).'
          )
        }
      }

      const sendOfficial =
        Boolean(officialTeamId) && (mapWinnerTeamId === null || officialTeamId !== mapWinnerTeamId)

      const mapNotes =
        Object.keys(mapNoteByOrder).length > 0
          ? Object.fromEntries(
              Object.entries(mapNoteByOrder).filter(([, v]) => String(v).trim().length > 0)
            )
          : undefined

      const response = await window.fetch('/api/admin/matches/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          bestOf: seriesMaps.length >= 5 ? 5 : 3,
          maps: seriesMaps,
          ...(sendOfficial && officialTeamId ? { officialWinnerTeamId: officialTeamId } : {}),
          ...(sendOfficial && forfeitReason.trim() ? { forfeitReason: forfeitReason.trim() } : {}),
          ...(sendOfficial && mapNotes && Object.keys(mapNotes).length > 0 ? { mapNotes } : {}),
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
      officialWinnerSide = 'map'
      forfeitReason = ''
      mapNoteByOrder = {}
    } catch (err) {
      submitMessage = err instanceof Error ? err.message : 'Failed to import series CSVs'
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
          <h1 class="admin-import-title">Match Import</h1>
          <p class="admin-hint mt-1">
            Upload all maps from a BO3/BO5 series together, or record a no-show forfeit without
            player stats. Series CSV import can override the official winner (e.g. rule violation)
            while keeping played map scores.
          </p>
        </div>
        <a href={resolve('/admin')} class="admin-back-link">
          <ArrowLeft size={14} /> Admin
        </a>
      </header>

      <section class="admin-card admin-card-pad">
        <div class="mb-4 flex flex-wrap gap-4 text-sm" style="color: var(--text);">
          <label class="inline-flex cursor-pointer items-center gap-2">
            <input type="radio" bind:group={importMode} value="riot_links" />
            <span>Tracker links / match ids</span>
          </label>
          <label class="inline-flex cursor-pointer items-center gap-2">
            <input type="radio" bind:group={importMode} value="series_csv" />
            <span>Series (map CSVs)</span>
          </label>
          <label class="inline-flex cursor-pointer items-center gap-2">
            <input type="radio" bind:group={importMode} value="forfeit_no_show" />
            <span>No-show forfeit (no stats)</span>
          </label>
        </div>

        {#if importMode === 'riot_links'}
          <div class="riot-import">
            <label class="block text-sm" style="color: var(--text);">
              <span class="mb-1 block font-semibold">Tracker links or Riot match ids</span>
              <textarea
                bind:value={riotInput}
                rows="4"
                class="admin-input w-full font-mono text-xs"
                placeholder="https://tracker.gg/valorant/match/…&#10;https://tracker.gg/valorant/match/…"
                disabled={isSubmitting}
              ></textarea>
              <span class="mt-1 block text-xs" style="color: rgba(255,255,255,0.6);">
                One per line, in map order. Teams and scores are read from the match itself.
              </span>
            </label>

            <div class="mt-3 flex flex-wrap items-end gap-3">
              <label class="block text-sm" style="color: var(--text);">
                <span class="mb-1 block font-semibold">Region</span>
                <div class="w-28">
                  <CustomSelect
                    options={riotRegionOptions}
                    bind:value={riotRegion}
                    disabled={isSubmitting}
                  />
                </div>
              </label>

              <label class="block text-sm" style="color: var(--text);">
                <span class="mb-1 block font-semibold">Best of</span>
                <div class="w-28">
                  <CustomSelect
                    options={riotBestOfOptions}
                    bind:value={riotBestOf}
                    placeholder="Auto"
                    disabled={isSubmitting}
                  />
                </div>
              </label>

              <button
                type="button"
                class="admin-btn admin-btn-neutral text-sm"
                onclick={() => runRiotImport(true)}
                disabled={isSubmitting || riotInput.trim().length === 0}
              >
                {#if isSubmitting && riotDryRun}
                  <span class="inline-flex items-center gap-2">
                    <Loader2 size={16} class="animate-spin" /> Checking…
                  </span>
                {:else}
                  Preview
                {/if}
              </button>
            </div>

            <p class="mt-3 text-xs leading-relaxed" style="color: rgba(255,255,255,0.6);">
              Riot keeps match details for roughly two months, so import a series while it is
              recent. Older matches are gone from Riot's side — use the map CSVs for those.
            </p>

            {#if riotPreview}
              <div class="admin-subcard mt-3 rounded-md border p-3 text-sm">
                <div class="font-semibold" style="color: var(--text);">
                  {riotPreview.teamA.name} vs {riotPreview.teamB.name}
                </div>
                <div class="mt-1 text-xs" style="color: rgba(255,255,255,0.7);">
                  Identified from {riotPreview.teamA.rosterVotes} and {riotPreview.teamB
                    .rosterVotes} players on the rosters.
                </div>
                <ul class="mt-2 space-y-1 text-xs" style="color: rgba(255,255,255,0.8);">
                  {#each riotPreview.maps as map, index (map.matchId)}
                    <li>
                      Map {index + 1}: <strong>{map.mapName ?? 'Unknown'}</strong>
                      {map.score}
                      <span style="color: rgba(255,255,255,0.5);">({map.playerCount} players)</span>
                    </li>
                  {/each}
                </ul>
                {#if riotPreview.unmatchedPlayers.length > 0}
                  <div class="mt-2 text-xs" style="color: #fbbf24;">
                    Not on any roster, so they import by name only:
                    {riotPreview.unmatchedPlayers.join(', ')}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        {#if importMode === 'forfeit_no_show'}
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label class="block text-sm" style="color: var(--text);">
              <span
                class="mb-1 block text-xs font-semibold uppercase"
                style="color: rgba(255,255,255,0.7);">Team A</span
              >
              <select bind:value={ffTeamAId} class="admin-input">
                <option value="">Select team…</option>
                {#each data.teams ?? [] as team (team.id)}
                  <option value={team.id}>{team.name}{team.tag ? ` [${team.tag}]` : ''}</option>
                {/each}
              </select>
            </label>
            <label class="block text-sm" style="color: var(--text);">
              <span
                class="mb-1 block text-xs font-semibold uppercase"
                style="color: rgba(255,255,255,0.7);">Team B</span
              >
              <select bind:value={ffTeamBId} class="admin-input">
                <option value="">Select team…</option>
                {#each data.teams ?? [] as team (team.id)}
                  <option value={team.id}>{team.name}{team.tag ? ` [${team.tag}]` : ''}</option>
                {/each}
              </select>
            </label>
            <label class="block text-sm md:col-span-2" style="color: var(--text);">
              <span
                class="mb-1 block text-xs font-semibold uppercase"
                style="color: rgba(255,255,255,0.7);">Match date</span
              >
              <input
                bind:value={ffScheduledAt}
                placeholder="DD/MM/YYYY or ISO date"
                class="admin-input"
              />
            </label>
            <label class="block text-sm md:col-span-2" style="color: var(--text);">
              <span
                class="mb-1 block text-xs font-semibold uppercase"
                style="color: rgba(255,255,255,0.7);">Winner</span
              >
              <select bind:value={ffWinnerTeamId} class="admin-input">
                <option value="">Select winner…</option>
                {#if ffTeamAId}
                  <option value={ffTeamAId}
                    >{(data.teams ?? []).find((t) => t.id === ffTeamAId)?.name ?? 'Team A'}</option
                  >
                {/if}
                {#if ffTeamBId}
                  <option value={ffTeamBId}
                    >{(data.teams ?? []).find((t) => t.id === ffTeamBId)?.name ?? 'Team B'}</option
                  >
                {/if}
              </select>
            </label>
            <label class="block text-sm" style="color: var(--text);">
              <span
                class="mb-1 block text-xs font-semibold uppercase"
                style="color: rgba(255,255,255,0.7);">Score (team A)</span
              >
              <input type="number" min="0" bind:value={ffTeamAScore} class="admin-input" />
            </label>
            <label class="block text-sm" style="color: var(--text);">
              <span
                class="mb-1 block text-xs font-semibold uppercase"
                style="color: rgba(255,255,255,0.7);">Score (team B)</span
              >
              <input type="number" min="0" bind:value={ffTeamBScore} class="admin-input" />
            </label>
            <label class="block text-sm md:col-span-2" style="color: var(--text);">
              <span
                class="mb-1 block text-xs font-semibold uppercase"
                style="color: rgba(255,255,255,0.7);">Best of</span
              >
              <div class="max-w-xs">
                <CustomSelect
                  options={forfeitBestOfOptions}
                  value={String(ffBestOf)}
                  onSelect={(v) => (ffBestOf = Number(v))}
                />
              </div>
            </label>
          </div>
        {:else}
          <label class="admin-dropzone">
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
        {/if}

        <label class="mt-4 block">
          <div class="admin-field-label">Display Name</div>
          <input bind:value={displayName} class="admin-input" placeholder="Series Import" />
        </label>

        {#if parseError}
          <div class="admin-alert admin-alert-error mt-3">
            {parseError}
          </div>
        {/if}
        {#if submitMessage}
          <div class="admin-note mt-3">
            {submitMessage}
          </div>
        {/if}
      </section>

      {#if importMode === 'series_csv'}
        <section class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div class="admin-stat">
            <div class="admin-stat-label">
              <Layers3 size={16} /> Maps
            </div>
            <div class="admin-stat-value">
              {seriesSummary.mapCount}
            </div>
          </div>
          <div class="admin-stat">
            <div class="admin-stat-label">
              <CheckCircle2 size={16} /> Matched Players
            </div>
            <div class="admin-stat-value" style="color: #86efac;">
              {seriesSummary.matchedPlayers}
            </div>
          </div>
          <div class="admin-stat">
            <div class="admin-stat-label">
              <AlertTriangle size={16} /> Unmatched Players
            </div>
            <div class="admin-stat-value" style="color: #fca5a5;">
              {seriesSummary.unmatchedPlayers}
            </div>
          </div>
          <div class="admin-stat">
            <div class="admin-stat-label">
              <CheckCircle2 size={16} /> Teams Matched
            </div>
            <div class="admin-stat-value">
              {seriesSummary.teamsMatched}/2
            </div>
          </div>
        </section>
      {/if}

      <section class="admin-card admin-card-pad">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <div class="text-sm font-semibold" style="color: var(--text);">
              {#if importMode === 'forfeit_no_show'}No-show forfeit{:else if importMode === 'riot_links'}Riot
                import{:else}Series Summary{/if}
            </div>
            <div class="mt-1 text-xs leading-relaxed" style="color: rgba(255,255,255,0.72);">
              {#if importMode === 'forfeit_no_show'}
                Save a completed match with no map stats (e.g. opponent no-show).
              {:else if importMode === 'riot_links'}
                Preview first to check the teams were identified correctly, then import.
              {:else}
                Review the series-level match info and each imported map below.
              {/if}
            </div>
          </div>
          <button
            type="button"
            class="admin-btn admin-btn-info text-sm"
            onclick={() => (importMode === 'riot_links' ? runRiotImport(false) : submitImport())}
            disabled={isSubmitting ||
              (importMode === 'series_csv' && seriesMaps.length === 0) ||
              (importMode === 'riot_links' && riotInput.trim().length === 0) ||
              (importMode === 'forfeit_no_show' &&
                (!ffTeamAId || !ffTeamBId || !ffScheduledAt.trim() || !ffWinnerTeamId))}
          >
            {#if isSubmitting}<span class="inline-flex items-center gap-2"
                ><Loader2 size={16} class="animate-spin" /> Saving…</span
              >{:else if importMode === 'forfeit_no_show'}Save forfeit match{:else}Import Series{/if}
          </button>
        </div>

        {#if importMode === 'series_csv' && seriesSummary.first}
          <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div class="admin-subcard rounded-md border p-3">
              <div
                class="text-xs font-semibold tracking-wide uppercase"
                style="color: rgba(255,255,255,0.7);"
              >
                Teams
              </div>
              <div class="mt-1 font-semibold" style="color: var(--text);">
                {seriesSummary.first.teamAName} vs {seriesSummary.first.teamBName}
              </div>
            </div>
            <div class="admin-subcard rounded-md border p-3">
              <div
                class="text-xs font-semibold tracking-wide uppercase"
                style="color: rgba(255,255,255,0.7);"
              >
                Series Score
              </div>
              <div class="mt-1 font-semibold" style="color: var(--text);">
                {seriesSummary.seriesWinsA}-{seriesSummary.seriesWinsB}
              </div>
            </div>
            <div class="admin-subcard rounded-md border p-3">
              <div
                class="text-xs font-semibold tracking-wide uppercase"
                style="color: rgba(255,255,255,0.7);"
              >
                Date
              </div>
              <div class="mt-1 font-semibold" style="color: var(--text);">
                {seriesSummary.first.scheduledAt || '—'}
              </div>
            </div>
          </div>

          {#if seriesSummary.teamsMatched === 2}
            <div class="admin-alert admin-alert-warn mt-4 space-y-2">
              <div class="text-sm font-semibold" style="color: var(--text);">
                Official series winner
              </div>
              <p class="text-xs leading-relaxed" style="color: rgba(255,255,255,0.72);">
                Map-derived winner (from round scores):
                {#if mapWinnerTeamId}
                  {mapWinnerTeamId === teamNameMap.get(normalizeKey(seriesSummary.first.teamAName))
                    ? seriesSummary.first.teamAName
                    : seriesSummary.first.teamBName}
                {:else}
                  Tie — choose the official winner below.
                {/if}
              </p>
              <label class="block text-sm" style="color: var(--text);">
                <span
                  class="mb-1 block text-xs font-semibold uppercase"
                  style="color: rgba(255,255,255,0.7);">Series winner</span
                >
                <select bind:value={officialWinnerSide} class="admin-input max-w-md">
                  <option value="map">Same as map result</option>
                  <option value="a">{seriesSummary.first.teamAName} (footer team A)</option>
                  <option value="b">{seriesSummary.first.teamBName} (footer team B)</option>
                </select>
              </label>
              {#if showForfeitExtras}
                <label class="block text-sm" style="color: var(--text);">
                  <span
                    class="mb-1 block text-xs font-semibold uppercase"
                    style="color: rgba(255,255,255,0.7);">Note (optional)</span
                  >
                  <input
                    bind:value={forfeitReason}
                    class="admin-input"
                    placeholder="e.g. Rule violation — series awarded to opponent"
                  />
                </label>
              {/if}
            </div>
          {/if}

          <div class="mt-4 space-y-3">
            {#each seriesMaps as map, index (map.sourceFilename + ':' + index)}
              <div class="admin-subcard rounded-md border p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="font-semibold" style="color: var(--text);">
                    Map {index + 1}: {map.mapName || '—'}
                  </div>
                  <div class="text-sm" style="color: rgba(255,255,255,0.78);">
                    {map.teamARounds}-{map.teamBRounds}
                  </div>
                </div>
                <div class="mt-1.5 text-xs leading-relaxed" style="color: rgba(255,255,255,0.72);">
                  {map.sourceFilename}
                </div>
                {#if showForfeitExtras}
                  <label class="mt-2 block text-xs" style="color: rgba(255,255,255,0.75);">
                    <span class="mb-1 block font-semibold" style="color: var(--text);"
                      >Map disclaimer (optional)</span
                    >
                    <textarea
                      class="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
                      style="border-color: rgba(255,255,255,0.45); background: rgba(0,0,0,0.2); color: var(--text);"
                      rows="2"
                      placeholder="Shown on the public match page for this map"
                      value={mapNoteByOrder[String(index + 1)] ?? ''}
                      oninput={(e) => {
                        mapNoteByOrder = {
                          ...mapNoteByOrder,
                          [String(index + 1)]: e.currentTarget.value,
                        }
                      }}
                    ></textarea>
                  </label>
                {/if}
              </div>
            {/each}
          </div>
        {:else if importMode === 'series_csv'}
          <div class="text-sm leading-relaxed" style="color: rgba(255,255,255,0.78);">
            No series parsed yet.
          </div>
        {/if}
      </section>
    </div>
  </div>
</PageContainer>
